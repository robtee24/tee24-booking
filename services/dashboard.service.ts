// services/dashboard.service.ts
// Live data for the per-location dashboard: payments-this-month, today's
// reservations, the computed "needs attention" list (+ dismissals), open
// tasks, and overdue invoices. All reads; dismissals are AdminNotification
// rows of kind `alert.dismissed` so we don't need a new table.
import { getPrisma } from "@/lib/db";
import { adminRoutes } from "@/lib/admin/routes";
import { audit } from "@/lib/audit";

/* ────────────────────────────── Payments ──────────────────────────────── */

export type MoneyBucket = { cents: number; count: number };
export type PaymentsThisMonth = { scheduled: MoneyBucket; paid: MoneyBucket; overdue: MoneyBucket; monthStart: Date; monthEnd: Date };

export async function getPaymentsThisMonth(locationId: string, now = new Date()): Promise<PaymentsThisMonth> {
  const prisma = getPrisma();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const inMonth = { gte: monthStart, lt: monthEnd };
  const bucket = (r: { _sum: { totalCents: number | null }; _count: number }): MoneyBucket => ({ cents: r._sum.totalCents ?? 0, count: r._count });

  const [scheduled, paid, overdue] = await Promise.all([
    prisma.invoice.aggregate({ _sum: { totalCents: true }, _count: true, where: { locationId, status: "SCHEDULED", dueDate: inMonth } }),
    prisma.invoice.aggregate({ _sum: { totalCents: true }, _count: true, where: { locationId, status: { in: ["PAID", "PARTIALLY_REFUNDED"] }, paidAt: inMonth } }),
    // Overdue is "right now", regardless of month — anything past due or failed and not resolved.
    prisma.invoice.aggregate({ _sum: { totalCents: true }, _count: true, where: { locationId, status: { in: ["PAST_DUE", "FAILED"] } } }),
  ]);
  return { scheduled: bucket(scheduled), paid: bucket(paid), overdue: bucket(overdue), monthStart, monthEnd };
}

/* ──────────────────────────── Reservations ────────────────────────────── */

export type ReservationRow = {
  id: string;
  bayNumber: number;
  start: Date;
  end: Date;
  name: string;
  memberId: string | null;
  checkedInAt: Date | null;
  status: "in-progress" | "upcoming" | "past";
};

export async function getTodayReservations(locationId: string, opts: { limit?: number; now?: Date } = {}): Promise<{ rows: ReservationRow[]; totalToday: number }> {
  const prisma = getPrisma();
  const now = opts.now ?? new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const where = { locationId, canceledAt: null, start: { gte: dayStart, lt: dayEnd } };
  const [totalToday, rows] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      // Next N: anything that hasn't ended yet, soonest first.
      where: { ...where, end: { gte: now } },
      orderBy: { start: "asc" },
      take: opts.limit ?? 8,
      select: { id: true, bayNumber: true, start: true, end: true, firstName: true, lastName: true, memberId: true, checkedInAt: true },
    }),
  ]);
  return {
    totalToday,
    rows: rows.map((b) => ({
      id: b.id,
      bayNumber: b.bayNumber,
      start: b.start,
      end: b.end,
      name: `${b.firstName} ${b.lastName}`.trim(),
      memberId: b.memberId,
      checkedInAt: b.checkedInAt,
      status: b.start <= now && b.end > now ? "in-progress" : b.start > now ? "upcoming" : "past",
    })),
  };
}

/* ───────────────────────────── Attention ──────────────────────────────── */

export type AttentionKind =
  | "payment-failed"
  | "payment-overdue"
  | "membership-expiring"
  | "trial-ended"
  | "document-unsigned"
  | "card-expiring"
  | "cancel-requested"
  | "inactive-member";

export type AttentionItem = {
  /** Stable key used for dismissal, e.g. `payment-overdue:inv_123`. */
  key: string;
  kind: AttentionKind;
  severity: "ERROR" | "WARN" | "INFO";
  title: string;
  detail: string;
  memberId: string;
  memberName: string;
  href: string;
  /** Sort helper: most urgent first, then most recent. */
  at: Date;
};

const KIND_LABEL: Record<AttentionKind, string> = {
  "payment-failed": "Payment failed",
  "payment-overdue": "Payment overdue",
  "membership-expiring": "Membership expiring",
  "trial-ended": "Trial ended",
  "document-unsigned": "Unsigned document",
  "card-expiring": "Card expiring",
  "cancel-requested": "Cancellation requested",
  "inactive-member": "Inactive member",
};

export function attentionKindLabel(kind: AttentionKind) {
  return KIND_LABEL[kind];
}

const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateShort = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

type MemberLite = { id: string; firstName: string; lastName: string };
const nameOf = (m: MemberLite) => `${m.firstName} ${m.lastName}`.trim() || "Member";

export async function computeAttentionItems(opts: { locationId: string; locationSlug: string; now?: Date; perKindLimit?: number }): Promise<AttentionItem[]> {
  const prisma = getPrisma();
  const now = opts.now ?? new Date();
  const limit = opts.perKindLimit ?? 25;
  const { locationId, locationSlug: slug } = opts;
  const in7d = new Date(now.getTime() + 7 * 86_400_000);
  const ago14d = new Date(now.getTime() - 14 * 86_400_000);
  const ago30d = new Date(now.getTime() - 30 * 86_400_000);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const memberSel = { select: { id: true, firstName: true, lastName: true } } as const;
  const profile = (memberId: string) => adminRoutes.loc.members.detail(slug, memberId);
  const billingTab = (memberId: string) => adminRoutes.loc.members.detailTab(slug, memberId, "payments");

  const [failed, overdue, expiring, cancelReq, unsigned, cards, trialEnded, activeSubs] = await Promise.all([
    prisma.invoice.findMany({
      where: { locationId, status: "FAILED" },
      orderBy: { dueDate: "desc" },
      take: limit,
      select: { id: true, totalCents: true, dueDate: true, lastFailureReason: true, attemptCount: true, member: memberSel },
    }),
    prisma.invoice.findMany({
      where: { locationId, status: "PAST_DUE" },
      orderBy: { dueDate: "asc" },
      take: limit,
      select: { id: true, totalCents: true, dueDate: true, member: memberSel },
    }),
    prisma.membershipSubscription.findMany({
      where: { locationId, status: { in: ["ACTIVE", "CANCEL_SCHEDULED"] }, OR: [{ endDate: { gte: now, lte: in7d } }, { cancelScheduledFor: { gte: now, lte: in7d } }] },
      take: limit,
      select: { id: true, endDate: true, cancelScheduledFor: true, plan: { select: { name: true } }, member: memberSel },
    }),
    prisma.membershipSubscription.findMany({
      where: { locationId, cancelRequestedAt: { not: null }, cancelledAt: null, status: { notIn: ["CANCELLED"] } },
      orderBy: { cancelRequestedAt: "desc" },
      take: limit,
      select: { id: true, cancelRequestedAt: true, cancelRequestReason: true, plan: { select: { name: true } }, member: memberSel },
    }),
    prisma.documentAssignment.findMany({
      where: {
        status: { in: ["SENT", "VIEWED"] },
        document: { requiredAtSignup: true, active: true },
        member: { locationId, status: { in: ["ACTIVE", "PENDING"] } },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true, createdAt: true, document: { select: { name: true } }, member: memberSel },
    }),
    prisma.paymentMethod.findMany({
      where: {
        member: { locationId, status: "ACTIVE" },
        status: { not: "EXPIRED" },
        isDefault: true,
        expYear: { not: null },
        expMonth: { not: null },
        OR: [
          { expYear: { lt: now.getFullYear() } },
          { expYear: now.getFullYear(), expMonth: { lte: now.getMonth() + 1 } },
        ],
      },
      take: limit,
      select: { id: true, brand: true, last4: true, expMonth: true, expYear: true, member: memberSel },
    }),
    // "Trial ended": a visitor/one-off/day-pass plan that ended in the last 14
    // days where the member has no active recurring membership.
    prisma.membershipSubscription.findMany({
      where: {
        locationId,
        endDate: { gte: ago14d, lte: now },
        status: { notIn: ["CANCELLED"] },
        plan: { OR: [{ category: "VISITOR" }, { productType: { in: ["ONE_OFF", "DAY_PASS", "PUNCH_CARD"] } }] },
        member: { membershipSubscriptions: { none: { status: "ACTIVE", plan: { productType: "RECURRING" } } } },
      },
      orderBy: { endDate: "desc" },
      take: limit,
      select: { id: true, endDate: true, plan: { select: { name: true } }, member: memberSel },
    }),
    // Inactive 30+ days with an active plan: pull active recurring members and
    // check their most recent visit in one grouped query below.
    prisma.membershipSubscription.findMany({
      where: { locationId, status: "ACTIVE", plan: { productType: "RECURRING" }, startDate: { lte: ago30d }, member: { status: "ACTIVE" } },
      take: 500,
      select: { memberId: true, plan: { select: { name: true } }, member: memberSel },
    }),
  ]);

  const items: AttentionItem[] = [];

  for (const inv of failed) {
    items.push({
      key: `payment-failed:${inv.id}`,
      kind: "payment-failed",
      severity: "ERROR",
      title: KIND_LABEL["payment-failed"],
      detail: `${money(inv.totalCents)} · ${inv.lastFailureReason || "card declined"}${inv.attemptCount > 1 ? ` · ${inv.attemptCount} attempts` : ""}`,
      memberId: inv.member.id,
      memberName: nameOf(inv.member),
      href: billingTab(inv.member.id),
      at: inv.dueDate,
    });
  }
  for (const inv of overdue) {
    const days = Math.max(1, Math.floor((now.getTime() - inv.dueDate.getTime()) / 86_400_000));
    items.push({
      key: `payment-overdue:${inv.id}`,
      kind: "payment-overdue",
      severity: days > 14 ? "ERROR" : "WARN",
      title: KIND_LABEL["payment-overdue"],
      detail: `${money(inv.totalCents)} · ${days} day${days === 1 ? "" : "s"} past due`,
      memberId: inv.member.id,
      memberName: nameOf(inv.member),
      href: billingTab(inv.member.id),
      at: inv.dueDate,
    });
  }
  for (const s of expiring) {
    const when = s.cancelScheduledFor ?? s.endDate ?? in7d;
    items.push({
      key: `membership-expiring:${s.id}:${when.toISOString().slice(0, 10)}`,
      kind: "membership-expiring",
      severity: "WARN",
      title: KIND_LABEL["membership-expiring"],
      detail: `${s.plan.name} ends ${dateShort(when)}`,
      memberId: s.member.id,
      memberName: nameOf(s.member),
      href: adminRoutes.loc.members.detailTab(slug, s.member.id, "memberships"),
      at: when,
    });
  }
  for (const s of trialEnded) {
    items.push({
      key: `trial-ended:${s.id}`,
      kind: "trial-ended",
      severity: "INFO",
      title: KIND_LABEL["trial-ended"],
      detail: `${s.plan.name} ended ${s.endDate ? dateShort(s.endDate) : "recently"} — follow up to convert`,
      memberId: s.member.id,
      memberName: nameOf(s.member),
      href: profile(s.member.id),
      at: s.endDate ?? now,
    });
  }
  for (const a of unsigned) {
    items.push({
      key: `document-unsigned:${a.id}`,
      kind: "document-unsigned",
      severity: "WARN",
      title: KIND_LABEL["document-unsigned"],
      detail: `${a.document.name} · sent ${dateShort(a.createdAt)}`,
      memberId: a.member.id,
      memberName: nameOf(a.member),
      href: adminRoutes.loc.members.detailTab(slug, a.member.id, "documents"),
      at: a.createdAt,
    });
  }
  for (const c of cards) {
    const expired = c.expYear! < now.getFullYear() || (c.expYear === now.getFullYear() && c.expMonth! < now.getMonth() + 1);
    items.push({
      key: `card-expiring:${c.id}:${c.expYear}-${c.expMonth}`,
      kind: "card-expiring",
      severity: expired ? "ERROR" : "WARN",
      title: expired ? "Card expired" : KIND_LABEL["card-expiring"],
      detail: `${c.brand ?? "Card"} •••• ${c.last4 ?? "????"} ${expired ? "expired" : "expires"} ${String(c.expMonth).padStart(2, "0")}/${c.expYear}`,
      memberId: c.member.id,
      memberName: nameOf(c.member),
      href: billingTab(c.member.id),
      at: new Date(c.expYear!, (c.expMonth ?? 1) - 1, 1),
    });
  }
  for (const s of cancelReq) {
    items.push({
      key: `cancel-requested:${s.id}:${s.cancelRequestedAt?.toISOString().slice(0, 10)}`,
      kind: "cancel-requested",
      severity: "WARN",
      title: KIND_LABEL["cancel-requested"],
      detail: `${s.plan.name}${s.cancelRequestReason ? ` · "${s.cancelRequestReason.slice(0, 80)}"` : ""}`,
      memberId: s.member.id,
      memberName: nameOf(s.member),
      href: adminRoutes.loc.members.detailTab(slug, s.member.id, "memberships"),
      at: s.cancelRequestedAt ?? now,
    });
  }

  if (activeSubs.length > 0) {
    const memberIds = [...new Set(activeSubs.map((s) => s.memberId))];
    const lastVisits = await prisma.visit.groupBy({
      by: ["memberId"],
      where: { locationId, memberId: { in: memberIds }, enteredAt: { gte: ago30d } },
      _max: { enteredAt: true },
    });
    const seen = new Set(lastVisits.map((v) => v.memberId));
    const stale = activeSubs.filter((s) => !seen.has(s.memberId));
    // Only one row per member; find their last visit ever for the detail text.
    const uniq = new Map<string, (typeof stale)[number]>();
    for (const s of stale) if (!uniq.has(s.memberId)) uniq.set(s.memberId, s);
    const staleIds = [...uniq.keys()].slice(0, limit);
    const lastEver = staleIds.length
      ? await prisma.visit.groupBy({ by: ["memberId"], where: { locationId, memberId: { in: staleIds } }, _max: { enteredAt: true } })
      : [];
    const lastMap = new Map(lastEver.map((v) => [v.memberId, v._max.enteredAt]));
    for (const id of staleIds) {
      const s = uniq.get(id)!;
      const last = lastMap.get(id) ?? null;
      const days = last ? Math.floor((now.getTime() - last.getTime()) / 86_400_000) : null;
      items.push({
        key: `inactive-member:${id}:${now.toISOString().slice(0, 7)}`, // re-surfaces monthly
        kind: "inactive-member",
        severity: "INFO",
        title: KIND_LABEL["inactive-member"],
        detail: `${s.plan.name} · ${days != null ? `last visit ${days} days ago` : "no visits on record"}`,
        memberId: id,
        memberName: nameOf(s.member),
        href: adminRoutes.loc.members.detailTab(slug, id, "attendance"),
        at: last ?? ago30d,
      });
    }
  }

  const sevRank = { ERROR: 0, WARN: 1, INFO: 2 } as const;
  items.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.at.getTime() - a.at.getTime());
  return items;
}

/* ─────────────────────────── Dismissals ───────────────────────────────── */

export const ALERT_DISMISSED_KIND = "alert.dismissed";

export async function getDismissedAlertKeys(locationId: string): Promise<Set<string>> {
  const rows = await getPrisma().adminNotification.findMany({
    where: { locationId, kind: ALERT_DISMISSED_KIND },
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: { data: true },
  });
  const out = new Set<string>();
  for (const r of rows) {
    const d = r.data as { alertKey?: unknown } | null;
    if (d && typeof d.alertKey === "string") out.add(d.alertKey);
  }
  return out;
}

export async function dismissAlerts(opts: { locationId: string; organizationId?: string | null; alertKeys: string[]; adminId: string }): Promise<number> {
  const keys = [...new Set(opts.alertKeys.map((k) => String(k).trim()).filter((k) => k && k.length <= 200))].slice(0, 500);
  if (keys.length === 0) return 0;
  const already = await getDismissedAlertKeys(opts.locationId);
  const fresh = keys.filter((k) => !already.has(k));
  if (fresh.length === 0) return 0;
  const now = new Date();
  await getPrisma().adminNotification.createMany({
    data: fresh.map((alertKey) => ({
      organizationId: opts.organizationId ?? null,
      locationId: opts.locationId,
      kind: ALERT_DISMISSED_KIND,
      severity: "INFO",
      title: `Dismissed: ${alertKey.split(":")[0]}`,
      readAt: now, // never shows in the inbox as unread
      data: { alertKey, dismissedById: opts.adminId, dismissedAt: now.toISOString() },
    })),
  });
  void audit({
    actorId: opts.adminId,
    action: "settings.update",
    entityType: "Location",
    entityId: opts.locationId,
    metadata: { locationId: opts.locationId, dismissedAlerts: fresh.length, keys: fresh.slice(0, 20) },
  });
  return fresh.length;
}

export async function getAttentionList(opts: { locationId: string; locationSlug: string; now?: Date }) {
  const [items, dismissed] = await Promise.all([computeAttentionItems(opts), getDismissedAlertKeys(opts.locationId)]);
  const visible = items.filter((i) => !dismissed.has(i.key));
  return { items: visible, dismissedCount: items.length - visible.length };
}

/* ─────────────────────────────── Tasks ────────────────────────────────── */

export type TasksWindow = "today" | "7d" | "30d" | "all";

export async function getDashboardTasks(opts: { locationId: string; adminId: string; window?: TasksWindow; limit?: number }) {
  const prisma = getPrisma();
  const now = new Date();
  const w = opts.window ?? "7d";
  const horizon = w === "today" ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) : w === "7d" ? new Date(now.getTime() + 7 * 86_400_000) : w === "30d" ? new Date(now.getTime() + 30 * 86_400_000) : null;
  const rows = await prisma.task.findMany({
    where: {
      status: { in: ["OPEN", "IN_PROGRESS"] },
      AND: [
        { OR: [{ assignedToId: opts.adminId }, { assignedToId: null, locationId: opts.locationId }] },
        ...(horizon ? [{ OR: [{ dueAt: null }, { dueAt: { lte: horizon } }] }] : []),
      ],
    },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }, { createdAt: "desc" }],
    take: opts.limit ?? 8,
    select: { id: true, title: true, dueAt: true, priority: true, status: true, memberId: true, assignedToId: true, assignee: { select: { name: true } } },
  });
  return rows.map((t) => ({ ...t, mine: t.assignedToId === opts.adminId, overdue: !!t.dueAt && t.dueAt < now }));
}

/* ───────────────────────── Overdue invoices ───────────────────────────── */

export async function getOverdueInvoices(locationId: string, limit = 6) {
  const prisma = getPrisma();
  const [rows, agg] = await Promise.all([
    prisma.invoice.findMany({
      where: { locationId, status: { in: ["PAST_DUE", "FAILED"] } },
      orderBy: { dueDate: "asc" },
      take: limit,
      select: { id: true, number: true, totalCents: true, dueDate: true, status: true, member: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.invoice.aggregate({ _sum: { totalCents: true }, _count: true, where: { locationId, status: { in: ["PAST_DUE", "FAILED"] } } }),
  ]);
  return { rows, totalCents: agg._sum.totalCents ?? 0, count: agg._count };
}
