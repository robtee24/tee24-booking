/**
 * Member service: queries + mutations.
 *
 * All mutations should go through this layer (rather than calling Prisma
 * directly) so we can attach audit logs, automation triggers, and
 * Kisi access syncs in one place.
 */
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import { audit, diff } from "@/lib/audit";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";

export type MemberStatus = "PENDING" | "ACTIVE" | "VISITOR" | "FROZEN" | "CANCELLED" | "MERGED";

export const MEMBER_STATUSES: MemberStatus[] = ["PENDING", "ACTIVE", "VISITOR", "FROZEN", "CANCELLED"];

export type MemberListFilter = {
  locationId?: string;
  locationIds?: string[];
  status?: MemberStatus | MemberStatus[];
  search?: string;
  tagIds?: string[];
  hasFailedPayment?: boolean;
  joinedSince?: Date;
  joinedUntil?: Date;
  sortBy?: "name" | "joinDate" | "status" | "lastVisit";
  sortDir?: "asc" | "desc";
  cursor?: string;
  limit?: number;
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Rich list (server-side filtering, sorting, offset pagination)             */
/* ────────────────────────────────────────────────────────────────────────── */

export type MemberQuery = {
  locationId: string;
  status?: MemberStatus[]; // omitted = all non-merged
  search?: string;
  tagIds?: string[];
  planId?: string;
  joinedFrom?: Date;
  joinedTo?: Date;
  membershipStartFrom?: Date;
  membershipStartTo?: Date;
  membershipEndFrom?: Date;
  membershipEndTo?: Date;
  birthMonth?: number; // 1-12
  gender?: string;
  minAge?: number;
  maxAge?: number;
  lastVisitBefore?: Date;
  lastVisitAfter?: Date;
  hasCard?: boolean;
  missingRequiredDoc?: boolean;
  emailOptIn?: boolean;
  smsOptIn?: boolean;
  sortBy?: "name" | "joinDate" | "lastVisit" | "age";
  sortDir?: "asc" | "desc";
  page?: number; // 1-based
  pageSize?: number;
};

export type MemberListRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  photoUrl: string | null;
  joinDate: Date | null;
  dob: Date | null;
  gender: string | null;
  checkinCode: string | null;
  membershipType: string | null;
  kisiAccessEnabled: boolean;
  memberTags: Array<{ tag: { id: string; name: string; color: string | null } }>;
  subscription: { id: string; status: string; planName: string; paidThroughDate: Date | null; nextInvoiceDate: Date | null } | null;
  lastVisitAt: Date | null;
  billing: { nextInvoiceDue: Date | null; nextInvoiceCents: number | null; overdueCents: number; overdueCount: number; hasCard: boolean };
};

function dobRangeForAges(minAge?: number, maxAge?: number): { gte?: Date; lte?: Date } | null {
  if (minAge == null && maxAge == null) return null;
  const now = new Date();
  const out: { gte?: Date; lte?: Date } = {};
  if (minAge != null) {
    // age >= minAge  =>  dob <= today - minAge years
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - minAge);
    out.lte = d;
  }
  if (maxAge != null) {
    // age <= maxAge  =>  dob > today - (maxAge+1) years
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - (maxAge + 1));
    d.setDate(d.getDate() + 1);
    out.gte = d;
  }
  return out;
}

export async function buildMemberWhere(q: MemberQuery, opts: { ignoreStatus?: boolean } = {}): Promise<Prisma.MemberWhereInput> {
  const prisma = getPrisma();
  const and: Prisma.MemberWhereInput[] = [{ locationId: q.locationId }, { status: { not: "MERGED" } }];

  if (!opts.ignoreStatus && q.status?.length) and.push({ status: { in: q.status } });

  if (q.search) {
    const s = q.search.trim();
    const digits = s.replace(/\D/g, "");
    const or: Prisma.MemberWhereInput[] = [
      { firstName: { contains: s, mode: "insensitive" } },
      { lastName: { contains: s, mode: "insensitive" } },
      { fullName: { contains: s, mode: "insensitive" } },
      { email: { contains: s, mode: "insensitive" } },
      { checkinCode: s },
    ];
    if (digits.length >= 3) or.push({ phone: { contains: digits } });
    and.push({ OR: or });
  }

  if (q.tagIds?.length) and.push({ memberTags: { some: { tagId: { in: q.tagIds } } } });
  if (q.planId) and.push({ membershipSubscriptions: { some: { planId: q.planId, status: { in: ["ACTIVE", "FROZEN", "CANCEL_SCHEDULED", "FREEZE_SCHEDULED", "COMP", "PENDING"] } } } });

  if (q.joinedFrom || q.joinedTo) {
    const r: Prisma.DateTimeNullableFilter = {};
    if (q.joinedFrom) r.gte = q.joinedFrom;
    if (q.joinedTo) r.lte = q.joinedTo;
    and.push({ joinDate: r });
  }
  if (q.membershipStartFrom || q.membershipStartTo) {
    const r: Prisma.DateTimeFilter = {};
    if (q.membershipStartFrom) r.gte = q.membershipStartFrom;
    if (q.membershipStartTo) r.lte = q.membershipStartTo;
    and.push({ membershipSubscriptions: { some: { startDate: r } } });
  }
  if (q.membershipEndFrom || q.membershipEndTo) {
    const r: Prisma.DateTimeNullableFilter = {};
    if (q.membershipEndFrom) r.gte = q.membershipEndFrom;
    if (q.membershipEndTo) r.lte = q.membershipEndTo;
    and.push({ membershipSubscriptions: { some: { OR: [{ endDate: r }, { paidThroughDate: r }] } } });
  }
  if (q.gender) and.push({ gender: { equals: q.gender, mode: "insensitive" } });

  const dobRange = dobRangeForAges(q.minAge, q.maxAge);
  if (dobRange) and.push({ dob: dobRange });

  if (q.birthMonth && q.birthMonth >= 1 && q.birthMonth <= 12) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Member" WHERE "locationId" = ${q.locationId} AND dob IS NOT NULL AND EXTRACT(MONTH FROM dob) = ${q.birthMonth}`;
    and.push({ id: { in: rows.map((r) => r.id) } });
  }

  if (q.lastVisitAfter) and.push({ visits: { some: { enteredAt: { gte: q.lastVisitAfter } } } });
  if (q.lastVisitBefore) and.push({ visits: { none: { enteredAt: { gte: q.lastVisitBefore } } } });

  if (q.hasCard === true) and.push({ paymentMethods: { some: { status: "ACTIVE" } } });
  if (q.hasCard === false) and.push({ paymentMethods: { none: { status: "ACTIVE" } } });

  if (q.emailOptIn != null) and.push({ optInEmailMarketing: q.emailOptIn });
  if (q.smsOptIn != null) and.push({ optInSmsMarketing: q.smsOptIn });

  if (q.missingRequiredDoc) {
    const loc = await prisma.location.findUnique({ where: { id: q.locationId }, select: { organizationId: true } });
    const docs = await prisma.document.findMany({
      where: { active: true, requiredAtSignup: true, OR: [{ organizationId: loc?.organizationId ?? null }, { organizationId: null }] },
      select: { id: true },
    });
    if (docs.length) {
      and.push({ OR: docs.map((d) => ({ documentAssignments: { none: { documentId: d.id, status: "SIGNED" } } })) });
    } else {
      and.push({ id: "__none__" });
    }
  }

  return { AND: and };
}

export async function queryMembers(q: MemberQuery): Promise<{ items: MemberListRow[]; total: number; page: number; pageSize: number }> {
  const prisma = getPrisma();
  const where = await buildMemberWhere(q);
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 25));
  const dir = q.sortDir ?? (q.sortBy === "lastVisit" || q.sortBy === "joinDate" ? "desc" : "asc");
  const sortBy = q.sortBy ?? "name";

  // Light pass: every matching id with the fields needed to sort.
  const light = await prisma.member.findMany({
    where,
    select: { id: true, firstName: true, lastName: true, joinDate: true, dob: true },
  });
  const total = light.length;

  let lastVisitMap = new Map<string, Date>();
  if (sortBy === "lastVisit" || total <= pageSize) {
    const agg = await prisma.visit.groupBy({
      by: ["memberId"],
      where: { memberId: { in: light.map((m) => m.id) } },
      _max: { enteredAt: true },
    });
    lastVisitMap = new Map(agg.filter((a) => a.memberId && a._max.enteredAt).map((a) => [a.memberId as string, a._max.enteredAt as Date]));
  }

  const mul = dir === "asc" ? 1 : -1;
  const cmpNullableDate = (a: Date | null | undefined, b: Date | null | undefined) => {
    if (!a && !b) return 0;
    if (!a) return 1; // nulls last regardless of direction
    if (!b) return -1;
    return (a.getTime() - b.getTime()) * mul;
  };
  light.sort((a, b) => {
    switch (sortBy) {
      case "joinDate": return cmpNullableDate(a.joinDate, b.joinDate) || a.lastName.localeCompare(b.lastName);
      case "lastVisit": return cmpNullableDate(lastVisitMap.get(a.id), lastVisitMap.get(b.id)) || a.lastName.localeCompare(b.lastName);
      case "age": return cmpNullableDate(b.dob, a.dob) || a.lastName.localeCompare(b.lastName); // older first when asc
      default: return (a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)) * mul;
    }
  });

  const pageIds = light.slice((page - 1) * pageSize, page * pageSize).map((m) => m.id);
  if (pageIds.length === 0) return { items: [], total, page, pageSize };

  const [rows, subs, visitAgg, invoices, cards] = await Promise.all([
    prisma.member.findMany({
      where: { id: { in: pageIds } },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true, status: true, photoUrl: true,
        joinDate: true, dob: true, gender: true, checkinCode: true, membershipType: true, kisiAccessEnabled: true,
        memberTags: { select: { tag: { select: { id: true, name: true, color: true } } } },
      },
    }),
    prisma.membershipSubscription.findMany({
      where: { memberId: { in: pageIds }, status: { in: ["ACTIVE", "FROZEN", "CANCEL_SCHEDULED", "FREEZE_SCHEDULED", "COMP", "PENDING"] } },
      orderBy: { startDate: "desc" },
      select: { id: true, memberId: true, status: true, paidThroughDate: true, nextInvoiceDate: true, plan: { select: { name: true } } },
    }),
    prisma.visit.groupBy({ by: ["memberId"], where: { memberId: { in: pageIds } }, _max: { enteredAt: true } }),
    prisma.invoice.findMany({
      where: { memberId: { in: pageIds }, status: { in: ["SCHEDULED", "PAST_DUE", "FAILED"] } },
      select: { memberId: true, status: true, dueDate: true, totalCents: true, refundedCents: true },
    }),
    prisma.paymentMethod.findMany({ where: { memberId: { in: pageIds }, status: "ACTIVE" }, select: { memberId: true } }),
  ]);

  const subByMember = new Map<string, (typeof subs)[number]>();
  for (const s of subs) if (!subByMember.has(s.memberId)) subByMember.set(s.memberId, s);
  const lastVisit = new Map(visitAgg.filter((a) => a.memberId).map((a) => [a.memberId as string, a._max.enteredAt]));
  const cardSet = new Set(cards.map((c) => c.memberId));
  const billing = new Map<string, MemberListRow["billing"]>();
  for (const id of pageIds) billing.set(id, { nextInvoiceDue: null, nextInvoiceCents: null, overdueCents: 0, overdueCount: 0, hasCard: cardSet.has(id) });
  for (const inv of invoices) {
    const b = billing.get(inv.memberId)!;
    if (inv.status === "SCHEDULED") {
      if (!b.nextInvoiceDue || inv.dueDate < b.nextInvoiceDue) { b.nextInvoiceDue = inv.dueDate; b.nextInvoiceCents = inv.totalCents; }
    } else {
      b.overdueCount++;
      b.overdueCents += inv.totalCents - inv.refundedCents;
    }
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const items: MemberListRow[] = pageIds.map((id) => {
    const r = byId.get(id)!;
    const s = subByMember.get(id);
    return {
      ...r,
      subscription: s ? { id: s.id, status: s.status, planName: s.plan.name, paidThroughDate: s.paidThroughDate, nextInvoiceDate: s.nextInvoiceDate } : null,
      lastVisitAt: lastVisit.get(id) ?? null,
      billing: billing.get(id)!,
    };
  });
  return { items, total, page, pageSize };
}

export async function countMembersByStatus(q: MemberQuery): Promise<Record<string, number>> {
  const prisma = getPrisma();
  const where = await buildMemberWhere(q, { ignoreStatus: true });
  const groups = await prisma.member.groupBy({ by: ["status"], where, _count: { _all: true } });
  const out: Record<string, number> = { ALL: 0 };
  for (const s of MEMBER_STATUSES) out[s] = 0;
  for (const g of groups) {
    out[g.status] = g._count._all;
    out.ALL += g._count._all;
  }
  return out;
}

export async function listMembers(filter: MemberListFilter) {
  const prisma = getPrisma();
  const where: any = {};

  if (filter.locationId) where.locationId = filter.locationId;
  else if (filter.locationIds?.length) where.locationId = { in: filter.locationIds };

  if (filter.status) {
    where.status = Array.isArray(filter.status) ? { in: filter.status } : filter.status;
  }

  if (filter.search) {
    const s = filter.search.trim();
    where.OR = [
      { firstName: { contains: s, mode: "insensitive" } },
      { lastName: { contains: s, mode: "insensitive" } },
      { email: { contains: s, mode: "insensitive" } },
      { phone: { contains: s } },
      { fullName: { contains: s, mode: "insensitive" } },
    ];
  }

  if (filter.tagIds?.length) {
    where.memberTags = { some: { tagId: { in: filter.tagIds } } };
  }

  if (filter.joinedSince || filter.joinedUntil) {
    where.joinDate = {};
    if (filter.joinedSince) where.joinDate.gte = filter.joinedSince;
    if (filter.joinedUntil) where.joinDate.lte = filter.joinedUntil;
  }

  const orderBy = (() => {
    const dir = filter.sortDir ?? "desc";
    switch (filter.sortBy) {
      case "name": return [{ lastName: dir }, { firstName: dir }];
      case "status": return [{ status: dir }];
      case "joinDate": return [{ joinDate: dir }];
      default: return [{ updatedAt: dir }];
    }
  })();

  const limit = filter.limit ?? 50;
  const rows = await prisma.member.findMany({
    where,
    orderBy: orderBy as any,
    take: limit + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      status: true,
      kisiAccessEnabled: true,
      kisiAccessReason: true,
      photoUrl: true,
      joinDate: true,
      membershipType: true,
      location: { select: { slug: true, name: true } },
      memberTags: { include: { tag: true } },
      _count: { select: { visits: true, invoices: true, membershipSubscriptions: true } },
    },
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export async function getMemberDetail(memberId: string) {
  const prisma = getPrisma();
  return prisma.member.findUnique({
    where: { id: memberId },
    include: {
      location: { select: { id: true, slug: true, name: true } },
      memberTags: { include: { tag: true } },
      emergencyContacts: true,
      paymentMethods: true,
      membershipSubscriptions: { include: { plan: true }, orderBy: { startDate: "desc" } },
      family: { include: { family: { include: { members: { include: { member: true } } } } } },
      paypalAccount: true,
      customFieldValues: { include: { field: true } },
      _count: {
        select: {
          visits: true,
          invoices: true,
          documentAssignments: true,
          messages: true,
          internalNotes: true,
        },
      },
    },
  });
}

export type CreateMemberInput = {
  organizationId?: string | null;
  locationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dob?: Date | null;
  gender?: string | null;
  source?: string;
  status?: MemberStatus;
  optInEmailMarketing?: boolean;
  optInSmsMarketing?: boolean;
  membershipType?: string | null;
  joinDate?: Date | null;
  homeLocationId?: string | null;
  secondaryEmails?: string[];
  secondaryPhones?: string[];
  guardianName?: string | null;
  acquisitionSource?: string | null;
  photoUrl?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  smsConsent?: boolean;
  smsConsentSource?: string | null;
  checkinCode?: string | null;
  actorId?: string;
};

export async function createMember(input: CreateMemberInput) {
  const prisma = getPrisma();
  const smsConsent = input.smsConsent ?? input.optInSmsMarketing ?? false;
  const member = await prisma.member.create({
    data: {
      organizationId: input.organizationId ?? null,
      locationId: input.locationId,
      homeLocationId: input.homeLocationId ?? input.locationId,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      fullName: `${input.firstName} ${input.lastName}`.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      dob: input.dob ?? null,
      gender: input.gender ?? null,
      source: input.source ?? "ADMIN",
      status: input.status ?? "PENDING",
      membershipType: input.membershipType ?? null,
      joinDate: input.joinDate ?? new Date(),
      optInEmailMarketing: input.optInEmailMarketing ?? true,
      optInSmsMarketing: input.optInSmsMarketing ?? false,
      smsConsentAt: smsConsent ? new Date() : null,
      smsConsentSource: smsConsent ? input.smsConsentSource ?? "admin_create" : null,
      referralCode: generateReferralCode(input.firstName, input.lastName),
      secondaryEmails: input.secondaryEmails?.length ? input.secondaryEmails : undefined,
      secondaryPhones: input.secondaryPhones?.length ? input.secondaryPhones : undefined,
      guardianName: input.guardianName ?? null,
      acquisitionSource: input.acquisitionSource ?? null,
      photoUrl: input.photoUrl ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      zip: input.zip ?? null,
      country: input.country ?? "US",
      checkinCode: input.checkinCode ?? (await generateCheckinCode(input.locationId)),
    },
  });

  void audit({
    organizationId: input.organizationId ?? null,
    actorId: input.actorId ?? null,
    action: "member.create",
    entityType: "Member",
    entityId: member.id,
    after: { ...member, passwordHash: undefined },
  });

  return member;
}

export type UpdateMemberInput = Partial<{
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dob: Date | null;
  gender: string | null;
  status: MemberStatus;
  homeLocationId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  optInEmailMarketing: boolean;
  optInSmsMarketing: boolean;
  photoUrl: string | null;
  secondaryEmails: string[];
  secondaryPhones: string[];
  guardianName: string | null;
  acquisitionSource: string | null;
  joinDate: Date | null;
  membershipType: string | null;
  smsConsent: boolean;
}>;

export async function updateMember(memberId: string, patch: UpdateMemberInput, actorId?: string) {
  const prisma = getPrisma();
  const before = await prisma.member.findUnique({ where: { id: memberId } });
  if (!before) throw new Error("Member not found");

  const { smsConsent, ...rest } = patch;
  const data: any = { ...rest };
  if (patch.firstName != null || patch.lastName != null) {
    const fn = patch.firstName ?? before.firstName;
    const ln = patch.lastName ?? before.lastName;
    data.fullName = `${fn} ${ln}`.trim();
  }
  if ((patch.optInSmsMarketing === true && !before.optInSmsMarketing) || (smsConsent === true && !before.smsConsentAt)) {
    data.smsConsentAt = new Date();
    data.smsConsentSource = "admin_edit";
  }
  if (smsConsent === false) {
    data.smsConsentAt = null;
    data.smsConsentSource = null;
    data.optInSmsMarketing = false;
  }
  if (patch.email != null) data.email = patch.email.trim().toLowerCase();
  if (patch.secondaryEmails) data.secondaryEmails = patch.secondaryEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (patch.secondaryPhones) data.secondaryPhones = patch.secondaryPhones.map((p) => p.trim()).filter(Boolean);

  const after = await prisma.member.update({ where: { id: memberId }, data });

  const { before: bDiff, after: aDiff } = diff(before as any, after as any);
  void audit({
    organizationId: before.organizationId,
    actorId,
    action: "member.update",
    entityType: "Member",
    entityId: memberId,
    before: bDiff,
    after: aDiff,
  });

  // Status changes ripple to access state
  if (patch.status && patch.status !== before.status) {
    void audit({
      organizationId: before.organizationId,
      actorId,
      action: "member.status-change",
      entityType: "Member",
      entityId: memberId,
      before: { status: before.status },
      after: { status: patch.status },
    });
    const desired = await computeDesiredAccessState(memberId);
    void applyAccessState(memberId, desired);
  }

  return after;
}

function generateReferralCode(first: string, last: string): string {
  const initials = (first[0] ?? "").toUpperCase() + (last[0] ?? "").toUpperCase();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${initials}${rand}`;
}

export async function addMemberTag(memberId: string, tagId: string, actorId?: string) {
  const prisma = getPrisma();
  const existing = await prisma.memberTag.findUnique({
    where: { memberId_tagId: { memberId, tagId } },
  });
  if (existing) return existing;
  const link = await prisma.memberTag.create({
    data: { memberId, tagId, taggedById: actorId },
  });
  void audit({
    actorId,
    action: "member.tag-add",
    entityType: "Member",
    entityId: memberId,
    metadata: { tagId },
  });
  return link;
}

export async function removeMemberTag(memberId: string, tagId: string, actorId?: string) {
  const prisma = getPrisma();
  await prisma.memberTag.deleteMany({
    where: { memberId, tagId },
  });
  void audit({
    actorId,
    action: "member.tag-remove",
    entityType: "Member",
    entityId: memberId,
    metadata: { tagId },
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Front-desk check-in codes                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** Generate a 4–6 digit code that is unique within the location. */
export async function generateCheckinCode(locationId: string): Promise<string> {
  const prisma = getPrisma();
  for (const digits of [4, 4, 4, 5, 5, 6, 6, 6]) {
    const min = 10 ** (digits - 1);
    const code = String(Math.floor(min + Math.random() * (9 * min)));
    const clash = await prisma.member.findFirst({ where: { locationId, checkinCode: code }, select: { id: true } });
    if (!clash) return code;
  }
  throw new Error("Could not generate a unique check-in code");
}

export async function setCheckinCode(memberId: string, code: string | null, actorId?: string) {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, locationId: true, checkinCode: true, organizationId: true } });
  if (!member) throw new Error("Member not found");
  let next = code;
  if (next === null) {
    next = await generateCheckinCode(member.locationId);
  } else {
    next = next.trim();
    if (!/^\d{4,6}$/.test(next)) throw new Error("Code must be 4–6 digits");
    const clash = await prisma.member.findFirst({ where: { locationId: member.locationId, checkinCode: next, NOT: { id: memberId } }, select: { id: true } });
    if (clash) throw new Error("That code is already in use at this location");
  }
  const updated = await prisma.member.update({ where: { id: memberId }, data: { checkinCode: next } });
  void audit({
    organizationId: member.organizationId,
    actorId,
    action: "member.update",
    entityType: "Member",
    entityId: memberId,
    before: { checkinCode: member.checkinCode },
    after: { checkinCode: next },
  });
  return updated;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Visitor → member                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

export async function convertVisitorToMember(memberId: string, actorId?: string) {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) throw new Error("Member not found");
  if (member.status !== "VISITOR") throw new Error("Only visitors can be converted");
  const hasActiveSub = await prisma.membershipSubscription.count({ where: { memberId, status: { in: ["ACTIVE", "COMP"] } } });
  const updated = await updateMember(memberId, { status: hasActiveSub ? "ACTIVE" : "PENDING", joinDate: member.joinDate ?? new Date() }, actorId);
  await prisma.visitor.updateMany({ where: { convertedToMemberId: memberId }, data: { stage: "CONVERTED" } });
  return updated;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Custom fields                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

export async function listCustomFieldDefinitions(organizationId: string | null) {
  return getPrisma().customFieldDefinition.findMany({
    where: { OR: [{ organizationId }, { organizationId: null }] },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/** values: { [fieldId]: string | number | boolean | string[] | null } */
export async function setCustomFieldValues(memberId: string, values: Record<string, unknown>, actorId?: string) {
  const prisma = getPrisma();
  const fieldIds = Object.keys(values);
  if (fieldIds.length === 0) return;
  const defs = await prisma.customFieldDefinition.findMany({ where: { id: { in: fieldIds } } });
  for (const def of defs) {
    const raw = values[def.id];
    if (raw === null || raw === "" || raw === undefined) {
      await prisma.customFieldValue.deleteMany({ where: { fieldId: def.id, memberId } });
      continue;
    }
    const data: { valueText: string | null; valueNumber: number | null; valueDate: Date | null; valueJson: Prisma.InputJsonValue | typeof Prisma.JsonNull } = { valueText: null, valueNumber: null, valueDate: null, valueJson: Prisma.JsonNull };
    switch (def.type) {
      case "NUMBER": data.valueNumber = Number(raw); break;
      case "DATE": data.valueDate = new Date(String(raw)); break;
      case "BOOLEAN": data.valueJson = Boolean(raw === true || raw === "true" || raw === "1"); break;
      case "MULTI_SELECT": data.valueJson = Array.isArray(raw) ? raw.map(String) : String(raw).split(",").map((s) => s.trim()).filter(Boolean); break;
      default: data.valueText = String(raw);
    }
    await prisma.customFieldValue.upsert({
      where: { fieldId_memberId: { fieldId: def.id, memberId } },
      create: { fieldId: def.id, memberId, ...data },
      update: data,
    });
  }
  void audit({ actorId, action: "member.update", entityType: "Member", entityId: memberId, metadata: { customFields: fieldIds } });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Notes                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export async function addMemberNote(memberId: string, body: string, opts: { internal?: boolean; authorId?: string }) {
  const prisma = getPrisma();
  const text = body.trim();
  if (!text) throw new Error("Note body is required");
  if (opts.internal) {
    return prisma.internalNote.create({ data: { memberId, body: text, authorId: opts.authorId ?? null } });
  }
  return prisma.memberNote.create({ data: { memberId, body: text, authorId: opts.authorId ?? null } });
}

export async function listMemberNotes(memberId: string, opts: { includeInternal: boolean }) {
  const prisma = getPrisma();
  const [notes, internal] = await Promise.all([
    prisma.memberNote.findMany({ where: { memberId }, orderBy: { createdAt: "desc" } }),
    opts.includeInternal ? prisma.internalNote.findMany({ where: { memberId }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
  ]);
  const authorIds = Array.from(new Set([...notes, ...internal].map((n) => n.authorId).filter(Boolean))) as string[];
  const admins = authorIds.length ? await prisma.admin.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(admins.map((a) => [a.id, a.name]));
  const decorate = <T extends { authorId: string | null }>(n: T) => ({ ...n, authorName: n.authorId ? nameOf.get(n.authorId) ?? "Admin" : "System" });
  return { notes: notes.map(decorate), internal: internal.map(decorate) };
}
