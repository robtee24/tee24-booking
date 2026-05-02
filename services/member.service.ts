/**
 * Member service: queries + mutations.
 *
 * All mutations should go through this layer (rather than calling Prisma
 * directly) so we can attach audit logs, automation triggers, and
 * Kisi access syncs in one place.
 */
import { getPrisma } from "@/lib/db";
import { audit, diff } from "@/lib/audit";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";

export type MemberStatus = "PENDING" | "ACTIVE" | "VISITOR" | "FROZEN" | "CANCELLED";

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
  actorId?: string;
};

export async function createMember(input: CreateMemberInput) {
  const prisma = getPrisma();
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
      smsConsentAt: input.optInSmsMarketing ? new Date() : null,
      smsConsentSource: input.optInSmsMarketing ? "admin_create" : null,
      referralCode: generateReferralCode(input.firstName, input.lastName),
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
}>;

export async function updateMember(memberId: string, patch: UpdateMemberInput, actorId?: string) {
  const prisma = getPrisma();
  const before = await prisma.member.findUnique({ where: { id: memberId } });
  if (!before) throw new Error("Member not found");

  const data: any = { ...patch };
  if (patch.firstName != null || patch.lastName != null) {
    const fn = patch.firstName ?? before.firstName;
    const ln = patch.lastName ?? before.lastName;
    data.fullName = `${fn} ${ln}`.trim();
  }
  if (patch.optInSmsMarketing === true && !before.optInSmsMarketing) {
    data.smsConsentAt = new Date();
    data.smsConsentSource = "admin_edit";
  }
  if (patch.email != null) data.email = patch.email.trim().toLowerCase();

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
  await prisma.memberTag.delete({
    where: { memberId_tagId: { memberId, tagId } },
  });
  void audit({
    actorId,
    action: "member.tag-remove",
    entityType: "Member",
    entityId: memberId,
    metadata: { tagId },
  });
}
