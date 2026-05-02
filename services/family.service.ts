/**
 * Family service — link members into a shared billing profile.
 *
 * Rules:
 *  - One Square customer per family (created lazily on first invoice).
 *  - Primary must be 18+; enforced by callers (UI) — service takes the role at face value.
 *  - Removing the primary requires designating a new primary first.
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";

export type FamilyRole = "PRIMARY" | "SPOUSE" | "CHILD" | "PARENT" | "GUARDIAN" | "OTHER";

export async function createFamily(opts: {
  name: string;
  primaryMemberId: string;
  actorId?: string;
}) {
  const prisma = getPrisma();
  const family = await prisma.familyAccount.create({
    data: {
      name: opts.name,
      primaryMemberId: opts.primaryMemberId,
      members: { create: { memberId: opts.primaryMemberId, role: "PRIMARY", isPrimary: true } },
    },
    include: { members: true },
  });

  await prisma.member.update({
    where: { id: opts.primaryMemberId },
    data: { familyAccountId: family.id },
  });

  void audit({
    actorId: opts.actorId,
    action: "member.update",
    entityType: "FamilyAccount",
    entityId: family.id,
    after: family,
    metadata: { event: "family.created", primaryMemberId: opts.primaryMemberId },
  });

  return family;
}

export async function addFamilyMember(opts: {
  familyId: string;
  memberId: string;
  role: FamilyRole;
  actorId?: string;
}) {
  const prisma = getPrisma();
  const link = await prisma.familyMember.create({
    data: { familyAccountId: opts.familyId, memberId: opts.memberId, role: opts.role },
  });
  await prisma.member.update({
    where: { id: opts.memberId },
    data: { familyAccountId: opts.familyId },
  });
  void audit({
    actorId: opts.actorId,
    action: "member.update",
    entityType: "FamilyAccount",
    entityId: opts.familyId,
    metadata: { event: "family.added-member", memberId: opts.memberId, role: opts.role },
  });
  return link;
}

export async function removeFamilyMember(opts: {
  familyId: string;
  memberId: string;
  actorId?: string;
}) {
  const prisma = getPrisma();
  const family = await prisma.familyAccount.findUnique({
    where: { id: opts.familyId },
    include: { members: true },
  });
  if (!family) throw new Error("Family not found");
  if (family.primaryMemberId === opts.memberId) {
    throw new Error("Designate a new primary before removing the current primary");
  }

  await prisma.familyMember.deleteMany({
    where: { familyAccountId: opts.familyId, memberId: opts.memberId },
  });
  await prisma.member.update({
    where: { id: opts.memberId },
    data: { familyAccountId: null },
  });

  void audit({
    actorId: opts.actorId,
    action: "member.update",
    entityType: "FamilyAccount",
    entityId: opts.familyId,
    metadata: { event: "family.removed-member", memberId: opts.memberId },
  });
}

export async function changePrimary(opts: {
  familyId: string;
  newPrimaryMemberId: string;
  actorId?: string;
}) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.familyMember.updateMany({
      where: { familyAccountId: opts.familyId, isPrimary: true },
      data: { isPrimary: false, role: "OTHER" },
    });
    await tx.familyMember.update({
      where: { familyAccountId_memberId: { familyAccountId: opts.familyId, memberId: opts.newPrimaryMemberId } } as any,
      data: { isPrimary: true, role: "PRIMARY" },
    }).catch(async () => {
      // If unique compound key isn't generated, fall back to updateMany
      await tx.familyMember.updateMany({
        where: { familyAccountId: opts.familyId, memberId: opts.newPrimaryMemberId },
        data: { isPrimary: true, role: "PRIMARY" },
      });
    });
    await tx.familyAccount.update({
      where: { id: opts.familyId },
      data: { primaryMemberId: opts.newPrimaryMemberId },
    });
  });

  void audit({
    actorId: opts.actorId,
    action: "member.update",
    entityType: "FamilyAccount",
    entityId: opts.familyId,
    metadata: { event: "family.changed-primary", newPrimaryMemberId: opts.newPrimaryMemberId },
  });
}

export async function getFamilyDetail(familyId: string) {
  const prisma = getPrisma();
  return prisma.familyAccount.findUnique({
    where: { id: familyId },
    include: {
      members: {
        include: {
          member: {
            include: {
              membershipSubscriptions: { include: { plan: true }, where: { status: { in: ["ACTIVE", "FROZEN", "CANCEL_SCHEDULED"] } } },
            },
          },
        },
      },
    },
  });
}
