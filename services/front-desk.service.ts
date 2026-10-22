/**
 * Front-desk service — kiosk-style check-in by code / name / phone / scan.
 *
 * Rules:
 *  - A check-in creates a Visit (source FRONT_DESK). If a booking for the member
 *    exists within ±2h at this location the visit is a RESERVATION and the
 *    booking is marked checked in; otherwise WALK_IN.
 *  - Location.attendanceDedupeHours: a second check-in inside the window does
 *    not create a new Visit (returns alreadyCheckedIn + time).
 *  - Blocks (unless `override`): membership not active (frozen / cancelled /
 *    pending / visitor without pass), unsigned required document, invoice
 *    overdue past Location.overdueBlockDays.
 */
import { addHours, addMinutes, subMinutes } from "date-fns";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emitMemberEvent } from "@/lib/events";

const BOOKING_MATCH_MINUTES = 120;

export type FrontDeskMember = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  photoUrl: string | null;
  status: string;
  checkinCode: string | null;
  membership: { planName: string; status: string; paidThroughDate: Date | null; freezeResumeDate: Date | null } | null;
  balanceCents: number; // outstanding (past-due + failed + scheduled-and-due)
  overdueCents: number;
  unsignedRequiredDocs: Array<{ documentId: string; name: string; assignmentId: string | null; signingUrl: string | null }>;
  lastVisitAt: Date | null;
  todayVisitAt: Date | null;
};

function signingUrl(token: string | null): string | null {
  if (!token) return null;
  const base = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  return `${base}/sign/${encodeURIComponent(token)}`;
}

async function decorate(memberIds: string[], locationId: string): Promise<FrontDeskMember[]> {
  if (memberIds.length === 0) return [];
  const prisma = getPrisma();
  const loc = await prisma.location.findUnique({ where: { id: locationId }, select: { organizationId: true, attendanceDedupeHours: true } });
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [members, subs, invoices, requiredDocs, assignments, visits] = await Promise.all([
    prisma.member.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, photoUrl: true, status: true, checkinCode: true },
    }),
    prisma.membershipSubscription.findMany({
      where: { memberId: { in: memberIds }, status: { in: ["ACTIVE", "COMP", "CANCEL_SCHEDULED", "FROZEN", "FREEZE_SCHEDULED", "PENDING"] } },
      orderBy: { startDate: "desc" },
      select: { memberId: true, status: true, paidThroughDate: true, freezeResumeDate: true, plan: { select: { name: true } } },
    }),
    prisma.invoice.findMany({
      where: { memberId: { in: memberIds }, status: { in: ["PAST_DUE", "FAILED", "SCHEDULED"] } },
      select: { memberId: true, status: true, dueDate: true, totalCents: true, refundedCents: true },
    }),
    prisma.document.findMany({
      where: { active: true, requiredAtSignup: true, OR: [{ organizationId: loc?.organizationId ?? null }, { organizationId: null }] },
      select: { id: true, name: true },
    }),
    prisma.documentAssignment.findMany({
      where: { memberId: { in: memberIds } },
      orderBy: { createdAt: "desc" },
      select: { id: true, memberId: true, documentId: true, status: true, signingToken: true },
    }),
    prisma.visit.findMany({
      where: { memberId: { in: memberIds }, locationId },
      orderBy: { enteredAt: "desc" },
      select: { memberId: true, enteredAt: true },
    }),
  ]);

  const order = new Map(memberIds.map((id, i) => [id, i]));
  return members
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((m) => {
      const sub = subs.find((s) => s.memberId === m.id);
      const inv = invoices.filter((i) => i.memberId === m.id);
      const balanceCents = inv.filter((i) => i.status !== "SCHEDULED" || i.dueDate <= now).reduce((s, i) => s + i.totalCents - i.refundedCents, 0);
      const overdueCents = inv.filter((i) => i.status === "PAST_DUE" || i.status === "FAILED").reduce((s, i) => s + i.totalCents - i.refundedCents, 0);
      const mine = assignments.filter((a) => a.memberId === m.id);
      const unsignedRequiredDocs = requiredDocs
        .filter((d) => !mine.some((a) => a.documentId === d.id && a.status === "SIGNED"))
        .map((d) => {
          const pending = mine.find((a) => a.documentId === d.id && (a.status === "SENT" || a.status === "VIEWED"));
          return { documentId: d.id, name: d.name, assignmentId: pending?.id ?? null, signingUrl: signingUrl(pending?.signingToken ?? null) };
        });
      const myVisits = visits.filter((v) => v.memberId === m.id);
      const todayVisit = myVisits.find((v) => v.enteredAt >= todayStart);
      return {
        ...m,
        membership: sub ? { planName: sub.plan.name, status: sub.status, paidThroughDate: sub.paidThroughDate, freezeResumeDate: sub.freezeResumeDate } : null,
        balanceCents,
        overdueCents,
        unsignedRequiredDocs,
        lastVisitAt: myVisits[0]?.enteredAt ?? null,
        todayVisitAt: todayVisit?.enteredAt ?? null,
      };
    });
}

/** Resolve by exact check-in code. */
export async function lookupByCode(locationId: string, code: string): Promise<FrontDeskMember | null> {
  const prisma = getPrisma();
  const m = await prisma.member.findFirst({ where: { locationId, checkinCode: code.trim(), status: { not: "MERGED" } }, select: { id: true } });
  if (!m) return null;
  return (await decorate([m.id], locationId))[0] ?? null;
}

/** Resolve a scanned string: member id, check-in code, or a URL containing one. */
export async function lookupByScan(locationId: string, scan: string): Promise<FrontDeskMember | null> {
  const prisma = getPrisma();
  let s = scan.trim();
  try {
    const u = new URL(s);
    s = u.searchParams.get("code") || u.searchParams.get("m") || u.pathname.split("/").filter(Boolean).pop() || s;
  } catch {
    /* not a URL */
  }
  if (/^\d{4,6}$/.test(s)) {
    const byCode = await lookupByCode(locationId, s);
    if (byCode) return byCode;
  }
  const m = await prisma.member.findFirst({ where: { id: s, locationId, status: { not: "MERGED" } }, select: { id: true } });
  if (!m) return null;
  return (await decorate([m.id], locationId))[0] ?? null;
}

/** Name / phone / email search (max 8). */
export async function searchMembers(locationId: string, query: string): Promise<FrontDeskMember[]> {
  const prisma = getPrisma();
  const q = query.trim();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const parts = q.split(/\s+/).filter(Boolean);
  const or: any[] = [
    { fullName: { contains: q, mode: "insensitive" } },
    { firstName: { contains: q, mode: "insensitive" } },
    { lastName: { contains: q, mode: "insensitive" } },
    { email: { contains: q, mode: "insensitive" } },
  ];
  if (parts.length >= 2) {
    or.push({ AND: [{ firstName: { contains: parts[0], mode: "insensitive" } }, { lastName: { contains: parts.slice(1).join(" "), mode: "insensitive" } }] });
  }
  if (digits.length >= 4) or.push({ phone: { contains: digits.slice(-Math.min(10, digits.length)) } });
  const rows = await prisma.member.findMany({
    where: { locationId, status: { not: "MERGED" }, OR: or },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 8,
    select: { id: true },
  });
  return decorate(rows.map((r) => r.id), locationId);
}

export type CheckInResult =
  | { ok: true; visitId: string; type: string; alreadyCheckedIn: false; member: FrontDeskMember }
  | { ok: true; visitId: string; type: string; alreadyCheckedIn: true; at: Date; member: FrontDeskMember }
  | { ok: false; blocked: true; reason: string; code: "MEMBERSHIP" | "DOCUMENT" | "OVERDUE"; member: FrontDeskMember };

export async function checkInMember(opts: {
  locationId: string;
  memberId: string;
  actorId?: string;
  override?: boolean;
  notes?: string;
}): Promise<CheckInResult> {
  const prisma = getPrisma();
  const [member] = await decorate([opts.memberId], opts.locationId);
  if (!member) throw new Error("Member not found at this location");
  const location = await prisma.location.findUnique({
    where: { id: opts.locationId },
    select: { attendanceDedupeHours: true, overdueBlockDays: true, organizationId: true },
  });
  if (!location) throw new Error("Location not found");
  const now = new Date();

  if (!opts.override) {
    // Membership state
    const sub = member.membership;
    const activeSub = sub && (sub.status === "ACTIVE" || sub.status === "COMP" || sub.status === "CANCEL_SCHEDULED");
    if (!(member.status === "ACTIVE" || activeSub)) {
      let reason = "No active membership on file.";
      if (member.status === "FROZEN" || sub?.status === "FROZEN") {
        reason = `Membership is frozen${sub?.freezeResumeDate ? ` — resumes ${sub.freezeResumeDate.toLocaleDateString()}` : ""}.`;
      } else if (member.status === "CANCELLED" || sub?.status === "CANCELLED") {
        reason = "Membership has been cancelled.";
      } else if (member.status === "PENDING") {
        reason = "Membership is pending — no active plan yet.";
      } else if (member.status === "VISITOR") {
        reason = "Visitor record — no active membership or day pass.";
      }
      return { ok: false, blocked: true, reason, code: "MEMBERSHIP", member };
    }
    // Required documents
    if (member.unsignedRequiredDocs.length > 0) {
      const names = member.unsignedRequiredDocs.map((d) => d.name).join(", ");
      return { ok: false, blocked: true, reason: `Required document not signed: ${names}.`, code: "DOCUMENT", member };
    }
    // Overdue
    if (location.overdueBlockDays != null) {
      const cutoff = new Date(now.getTime() - location.overdueBlockDays * 86_400_000);
      const overdue = await prisma.invoice.findFirst({
        where: { memberId: member.id, status: { in: ["PAST_DUE", "FAILED"] }, dueDate: { lte: cutoff } },
        select: { number: true, dueDate: true, totalCents: true },
      });
      if (overdue) {
        return {
          ok: false,
          blocked: true,
          reason: `Invoice #${overdue.number} is more than ${location.overdueBlockDays} days overdue (${(overdue.totalCents / 100).toFixed(2)}).`,
          code: "OVERDUE",
          member,
        };
      }
    }
  }

  // Dedupe window
  const windowStart = addHours(now, -location.attendanceDedupeHours);
  const recent = await prisma.visit.findFirst({
    where: { memberId: member.id, locationId: opts.locationId, enteredAt: { gte: windowStart, lte: now } },
    orderBy: { enteredAt: "desc" },
  });
  if (recent) {
    await prisma.visit.update({ where: { id: recent.id }, data: { unlockCount: { increment: 1 }, dedupedFromAt: now } });
    return { ok: true, visitId: recent.id, type: recent.type, alreadyCheckedIn: true, at: recent.enteredAt, member };
  }

  // Booking match ±2h
  let type = "WALK_IN";
  let bookingId: string | null = null;
  let bayId: string | null = null;
  const booking = await prisma.booking.findFirst({
    where: {
      locationId: opts.locationId,
      canceledAt: null,
      OR: [{ memberId: member.id }, { email: member.email }, { phone: member.phone }],
      start: { lte: addMinutes(now, BOOKING_MATCH_MINUTES) },
      end: { gte: subMinutes(now, BOOKING_MATCH_MINUTES) },
    },
    orderBy: { start: "asc" },
  });
  if (booking) {
    type = "RESERVATION";
    bookingId = booking.id;
    const bay = await prisma.bay.findFirst({ where: { locationId: opts.locationId, number: booking.bayNumber }, select: { id: true } });
    bayId = bay?.id ?? null;
    if (!booking.checkedInAt) {
      await prisma.booking.update({ where: { id: booking.id }, data: { checkedInAt: now } });
    }
  }

  const visit = await prisma.visit.create({
    data: {
      memberId: member.id,
      locationId: opts.locationId,
      bayId,
      bookingId,
      type,
      source: "FRONT_DESK",
      enteredAt: now,
      unlockCount: 1,
      notes: [opts.override ? "Checked in with staff override" : null, opts.notes?.trim() || null].filter(Boolean).join(" · ") || null,
    },
  });

  void audit({
    organizationId: location.organizationId,
    actorId: opts.actorId,
    action: "member.update",
    entityType: "Visit",
    entityId: visit.id,
    after: { memberId: member.id, type, source: "FRONT_DESK", override: !!opts.override },
    metadata: { event: "visit.checked-in" },
  });

  void emitMemberEvent("visit.checked-in", {
    memberId: member.id,
    locationId: opts.locationId,
    organizationId: location.organizationId,
    actorAdminId: opts.actorId ?? null,
    refs: { visitId: visit.id },
    vars: { visitType: type, firstName: member.firstName, lastName: member.lastName },
  });

  return { ok: true, visitId: visit.id, type, alreadyCheckedIn: false, member: { ...member, todayVisitAt: now, lastVisitAt: now } };
}

/** Walk-in guest: creates a Visitor (lead) + Visit. */
export async function walkInGuest(opts: { locationId: string; name: string; phone?: string | null; email?: string | null; actorId?: string }) {
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { id: opts.locationId }, select: { organizationId: true } });
  const [firstName, ...rest] = opts.name.trim().split(/\s+/);
  const lastName = rest.join(" ") || null;
  const phone = opts.phone?.trim() || null;
  const email = opts.email?.trim().toLowerCase() || null;

  let visitor = phone || email
    ? await prisma.visitor.findFirst({ where: { locationId: opts.locationId, OR: [phone ? { phone } : undefined, email ? { email } : undefined].filter(Boolean) as any } })
    : null;
  if (!visitor) {
    visitor = await prisma.visitor.create({
      data: { organizationId: location?.organizationId ?? null, locationId: opts.locationId, stage: "ENGAGED", source: "FRONT_DESK", firstName, lastName, phone, email },
    });
  } else {
    await prisma.visitor.update({ where: { id: visitor.id }, data: { lastContactedAt: new Date(), stage: visitor.stage === "NEW" ? "ENGAGED" : visitor.stage } });
  }
  await prisma.visitorEvent.create({ data: { visitorId: visitor.id, kind: "WALK_IN", data: { actorId: opts.actorId ?? null } } });
  const visit = await prisma.visit.create({
    data: { visitorId: visitor.id, locationId: opts.locationId, type: "WALK_IN", source: "FRONT_DESK", enteredAt: new Date(), unlockCount: 1 },
  });
  void emitMemberEvent("visit.checked-in", {
    visitorId: visitor.id,
    locationId: opts.locationId,
    organizationId: location?.organizationId ?? null,
    actorAdminId: opts.actorId ?? null,
    refs: { visitId: visit.id },
    vars: { visitType: "WALK_IN", guest: "yes", firstName, lastName },
  });
  return { visitor, visit };
}

export async function recentCheckins(locationId: string, since?: Date) {
  const prisma = getPrisma();
  const now = new Date();
  const from = since ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return prisma.visit.findMany({
    where: { locationId, enteredAt: { gte: from } },
    orderBy: { enteredAt: "desc" },
    take: 50,
    include: {
      member: { select: { id: true, firstName: true, lastName: true, photoUrl: true, status: true } },
      visitor: { select: { id: true, firstName: true, lastName: true } },
      bay: { select: { number: true } },
    },
  });
}
