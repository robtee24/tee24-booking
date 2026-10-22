/**
 * Server-side helpers that build chart-ready datasets from Prisma queries.
 * Keep these pure and cheap — they're invoked from page server components.
 */
import { getPrisma } from "@/lib/db";

/** Last N days as ISO strings (YYYY-MM-DD), oldest first. */
export function lastNDays(n: number, end: Date = new Date()): string[] {
  const out: string[] = [];
  const d = new Date(end);
  d.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

/** Last N months as { iso: 'YYYY-MM', label: 'MMM YY' }, oldest first. */
export function lastNMonths(n: number, end: Date = new Date()) {
  const out: { iso: string; label: string; start: Date; end: Date }[] = [];
  const d = new Date(end.getFullYear(), end.getMonth(), 1);
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(d);
    start.setMonth(d.getMonth() - i);
    const monthEnd = new Date(start);
    monthEnd.setMonth(start.getMonth() + 1);
    out.push({
      iso: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      label: start.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
      start,
      end: monthEnd,
    });
  }
  return out;
}

/**
 * Daily visit count for a location over the last `days` days.
 * Returns rows shaped for charting: { date, label, visits }.
 */
export async function visitsByDay(opts: { locationId: string; days: number }) {
  const days = lastNDays(opts.days);
  const start = new Date(days[0] + "T00:00:00");
  const visits = await getPrisma().visit.findMany({
    where: { locationId: opts.locationId, enteredAt: { gte: start } },
    select: { enteredAt: true },
  });
  const counts = new Map<string, number>();
  for (const d of days) counts.set(d, 0);
  for (const v of visits) {
    const k = v.enteredAt.toISOString().slice(0, 10);
    if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return days.map((d) => ({
    date: d,
    label: new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    visits: counts.get(d) ?? 0,
  }));
}

/** Today's visits bucketed into hourly slots (00..23). */
export async function visitsHourly(opts: { locationId: string; date?: Date }) {
  const day = opts.date ?? new Date();
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  const visits = await getPrisma().visit.findMany({
    where: { locationId: opts.locationId, enteredAt: { gte: start, lt: end } },
    select: { enteredAt: true },
  });
  const buckets = Array.from({ length: 24 }, (_, h) => ({
    hour: `${h.toString().padStart(2, "0")}:00`,
    visits: 0,
  }));
  for (const v of visits) {
    buckets[v.enteredAt.getHours()].visits++;
  }
  return buckets;
}

/** Member status counts → donut-ready slices. */
export async function memberStatusBreakdown(opts: { locationId: string }) {
  const rows = await getPrisma().member.groupBy({
    by: ["status"],
    where: { locationId: opts.locationId },
    _count: { _all: true },
  });
  return rows.map((r) => ({ name: String(r.status), value: r._count._all }));
}

/** Monthly revenue (paid charges) over the last N months. */
export async function revenueByMonth(opts: { locationId: string; months: number }) {
  const months = lastNMonths(opts.months);
  const start = months[0].start;
  const charges = await getPrisma().charge.findMany({
    where: {
      locationId: opts.locationId,
      status: "SUCCEEDED",
      createdAt: { gte: start },
    },
    select: { amountCents: true, createdAt: true },
  });
  const byKey = new Map<string, number>();
  for (const m of months) byKey.set(m.iso, 0);
  for (const c of charges) {
    const k = `${c.createdAt.getFullYear()}-${String(c.createdAt.getMonth() + 1).padStart(2, "0")}`;
    if (byKey.has(k)) byKey.set(k, (byKey.get(k) ?? 0) + c.amountCents);
  }
  return months.map((m) => ({
    month: m.label,
    revenue: Math.round((byKey.get(m.iso) ?? 0) / 100),
  }));
}

/** Member growth by month (cumulative active members). */
export async function memberGrowth(opts: { locationId: string; months: number }) {
  const months = lastNMonths(opts.months);
  const earliestEnd = months[months.length - 1].end;
  const members = await getPrisma().member.findMany({
    where: { locationId: opts.locationId, createdAt: { lt: earliestEnd } },
    select: { createdAt: true, status: true },
  });
  return months.map((m) => {
    let active = 0;
    let visitor = 0;
    for (const mem of members) {
      if (mem.createdAt >= m.end) continue;
      // count if they exist by the end of this month
      if (mem.status === "VISITOR") visitor++;
      else active++;
    }
    return { month: m.label, active, visitor };
  });
}

/** Subscription counts grouped by plan name. */
export async function subscriptionsByPlan(opts: { locationId: string }) {
  const subs = await getPrisma().membershipSubscription.findMany({
    where: { locationId: opts.locationId, status: { in: ["ACTIVE", "FROZEN"] } },
    select: { plan: { select: { name: true } } },
  });
  const byPlan = new Map<string, number>();
  for (const s of subs) {
    const k = s.plan?.name ?? "(none)";
    byPlan.set(k, (byPlan.get(k) ?? 0) + 1);
  }
  return Array.from(byPlan.entries()).map(([name, value]) => ({ name, value }));
}

/** Subscription status counts over the last N months. */
export async function subscriptionStatusOverTime(opts: { locationId: string; months: number }) {
  const months = lastNMonths(opts.months);
  const start = months[0].start;
  const subs = await getPrisma().membershipSubscription.findMany({
    where: { locationId: opts.locationId, createdAt: { gte: start } },
    select: { status: true, createdAt: true, cancelledAt: true, freezeStartDate: true },
  });
  return months.map((m) => {
    let active = 0;
    let frozen = 0;
    let cancelled = 0;
    for (const s of subs) {
      if (s.createdAt >= m.end) continue;
      if (s.cancelledAt && s.cancelledAt < m.end) cancelled++;
      else if (s.freezeStartDate && s.freezeStartDate < m.end) frozen++;
      else active++;
    }
    return { month: m.label, active, frozen, cancelled };
  });
}

/** Visit count distribution: how many members visited 1×, 2×, 3+× this month. */
export async function visitFrequencyDistribution(opts: { locationId: string }) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const visits = await getPrisma().visit.groupBy({
    by: ["memberId"],
    where: { locationId: opts.locationId, enteredAt: { gte: monthStart }, memberId: { not: null } },
    _count: { _all: true },
  });
  const buckets = [
    { range: "1 visit", min: 1, max: 1, members: 0 },
    { range: "2-3", min: 2, max: 3, members: 0 },
    { range: "4-7", min: 4, max: 7, members: 0 },
    { range: "8-15", min: 8, max: 15, members: 0 },
    { range: "16+", min: 16, max: Infinity, members: 0 },
  ];
  for (const v of visits) {
    const c = v._count._all;
    const b = buckets.find((b) => c >= b.min && c <= b.max);
    if (b) b.members++;
  }
  return buckets.map(({ range, members }) => ({ range, members }));
}

/** Top N most-visited members for a location this month. */
export async function topMembersByVisits(opts: { locationId: string; limit: number }) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const grouped = await getPrisma().visit.groupBy({
    by: ["memberId"],
    where: { locationId: opts.locationId, enteredAt: { gte: monthStart }, memberId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { memberId: "desc" } },
    take: opts.limit,
  });
  if (grouped.length === 0) return [];
  const memberIds = grouped.map((g) => g.memberId!).filter(Boolean);
  const members = await getPrisma().member.findMany({
    where: { id: { in: memberIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  return grouped
    .map((g) => {
      const m = byId.get(g.memberId!);
      return m ? { name: `${m.firstName} ${m.lastName}`, visits: g._count._all } : null;
    })
    .filter((x): x is { name: string; visits: number } => Boolean(x));
}

// Lead pipeline stages live in a client-safe module; re-exported here for server callers.
export { LEAD_STAGES, ALL_LEAD_STAGES, LEAD_CLOSED_STAGES, normalizeLeadStage, isClosedLeadStage, type LeadStage } from "@/components/admin/marketing/constants";
import { normalizeLeadStage, type LeadStage } from "@/components/admin/marketing/constants";

/** Stages that count as "reached at least X" for funnel math. */
const STAGE_RANK: Record<LeadStage, number> = { NEW: 0, CONTACTED: 1, BOOKED: 2, TRIAL: 3, CONVERTED: 4, LOST: -1, ARCHIVED: -1, SPAM: -1 };

function reached(stage: LeadStage, target: LeadStage): boolean {
  if (STAGE_RANK[stage] < 0) return false;
  return STAGE_RANK[stage] >= STAGE_RANK[target];
}

/** Lead → Member conversion funnel for the trailing N days. */
export async function visitorFunnel(opts: { locationId: string; days: number }) {
  const start = new Date();
  start.setDate(start.getDate() - opts.days);
  const rows = await getPrisma().visitor.findMany({
    where: { locationId: opts.locationId, createdAt: { gte: start }, stage: { not: "SPAM" } },
    select: { stage: true },
  });
  const stages = rows.map((r) => normalizeLeadStage(r.stage));
  return [
    { label: "Leads captured", value: stages.length },
    { label: "Contacted", value: stages.filter((s) => reached(s, "CONTACTED")).length },
    { label: "Booked / trial", value: stages.filter((s) => reached(s, "BOOKED")).length },
    { label: "Converted to member", value: stages.filter((s) => s === "CONVERTED").length },
  ];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Billing (owned by the billing module)                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Revenue by month net of refunds: successful charges minus completed refunds,
 * bucketed by the month the money moved. Shape: { month, revenue, refunds }.
 */
export async function billingRevenueByMonth(opts: { locationId: string; months: number }) {
  const months = lastNMonths(opts.months);
  const start = months[0].start;
  const prisma = getPrisma();
  const [charges, refunds] = await Promise.all([
    prisma.charge.findMany({
      where: { locationId: opts.locationId, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] }, createdAt: { gte: start } },
      select: { amountCents: true, createdAt: true },
    }),
    prisma.refund.findMany({
      where: { status: "COMPLETED", createdAt: { gte: start }, charge: { locationId: opts.locationId } },
      select: { amountCents: true, createdAt: true },
    }),
  ]);
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const gross = new Map<string, number>();
  const refunded = new Map<string, number>();
  for (const m of months) {
    gross.set(m.iso, 0);
    refunded.set(m.iso, 0);
  }
  for (const c of charges) if (gross.has(key(c.createdAt))) gross.set(key(c.createdAt), (gross.get(key(c.createdAt)) ?? 0) + c.amountCents);
  for (const r of refunds) if (refunded.has(key(r.createdAt))) refunded.set(key(r.createdAt), (refunded.get(key(r.createdAt)) ?? 0) + r.amountCents);
  return months.map((m) => ({
    month: m.label,
    revenue: Math.round(((gross.get(m.iso) ?? 0) - (refunded.get(m.iso) ?? 0)) / 100),
    refunds: Math.round((refunded.get(m.iso) ?? 0) / 100),
  }));
}

/**
 * Paid revenue grouped by membership plan for a date range (net of refunds).
 * Invoices without a subscription are grouped under their description.
 */
export async function revenueByPlan(opts: { locationId: string; start: Date; end: Date }) {
  const invoices = await getPrisma().invoice.findMany({
    where: { locationId: opts.locationId, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] }, paidAt: { gte: opts.start, lt: opts.end } },
    select: { totalCents: true, refundedCents: true, taxCents: true, surchargeCents: true, description: true, subscription: { select: { plan: { select: { id: true, name: true, glCode: true, incomeCategory: true } } } } },
  });
  const byKey = new Map<string, { name: string; glCode: string | null; incomeCategory: string | null; count: number; grossCents: number; netCents: number; taxCents: number }>();
  for (const inv of invoices) {
    const plan = inv.subscription?.plan;
    const k = plan ? `plan:${plan.id}` : `desc:${inv.description ?? "Other"}`;
    const row = byKey.get(k) ?? { name: plan?.name ?? inv.description ?? "Other", glCode: plan?.glCode ?? null, incomeCategory: plan?.incomeCategory ?? null, count: 0, grossCents: 0, netCents: 0, taxCents: 0 };
    row.count += 1;
    row.grossCents += inv.totalCents;
    row.netCents += inv.totalCents - inv.refundedCents;
    row.taxCents += inv.taxCents;
    byKey.set(k, row);
  }
  return Array.from(byKey.values()).sort((a, b) => b.netCents - a.netCents);
}

/**
 * Acquisition funnel broken down by source: leads → contacted → booked/trial →
 * converted → churned (converted members whose status is now CANCELLED).
 */
export async function acquisitionFunnelBySource(opts: { locationId: string; days: number }) {
  const start = new Date();
  start.setDate(start.getDate() - opts.days);
  const prisma = getPrisma();
  const rows = await prisma.visitor.findMany({
    where: { locationId: opts.locationId, createdAt: { gte: start }, stage: { not: "SPAM" } },
    select: { source: true, stage: true, convertedToMemberId: true },
  });
  const memberIds = rows.map((r) => r.convertedToMemberId).filter((x): x is string => !!x);
  const churned = new Set(
    memberIds.length
      ? (
          await prisma.member.findMany({
            where: { id: { in: memberIds }, status: "CANCELLED" },
            select: { id: true },
          })
        ).map((m) => m.id)
      : [],
  );
  const bySource = new Map<string, { source: string; leads: number; contacted: number; booked: number; converted: number; churned: number }>();
  for (const r of rows) {
    const key = r.source?.trim() || "Unknown";
    const cur = bySource.get(key) ?? { source: key, leads: 0, contacted: 0, booked: 0, converted: 0, churned: 0 };
    const st = normalizeLeadStage(r.stage);
    cur.leads++;
    if (reached(st, "CONTACTED")) cur.contacted++;
    if (reached(st, "BOOKED")) cur.booked++;
    if (st === "CONVERTED") cur.converted++;
    if (r.convertedToMemberId && churned.has(r.convertedToMemberId)) cur.churned++;
    bySource.set(key, cur);
  }
  return [...bySource.values()].sort((a, b) => b.leads - a.leads);
}

/** Leads whose nextFollowUpAt is due (today or overdue) and not yet closed. */
export async function followUpsDue(opts: { locationId: string; assignedToId?: string | null; limit?: number }) {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return getPrisma().visitor.findMany({
    where: {
      locationId: opts.locationId,
      nextFollowUpAt: { lte: endOfToday },
      stage: { notIn: ["CONVERTED", "LOST"] },
      ...(opts.assignedToId ? { assignedToId: opts.assignedToId } : {}),
    },
    orderBy: { nextFollowUpAt: "asc" },
    take: opts.limit ?? 10,
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, stage: true, nextFollowUpAt: true, assignedToId: true, source: true },
  });
}
