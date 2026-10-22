import { getPrisma } from "@/lib/db";
import type { getFamilyDetail } from "@/services/family.service";

export async function decorateFamily(family: Awaited<ReturnType<typeof getFamilyDetail>>) {
  if (!family) return null;
  const memberIds = family.members.map((m) => m.memberId);
  const sharedCards = await getPrisma().paymentMethod.findMany({
    where: { memberId: { in: memberIds }, isFamilyShared: true, status: "ACTIVE" },
    select: { id: true, memberId: true, brand: true, last4: true },
  });
  return {
    id: family.id,
    name: family.name,
    primaryMemberId: family.primaryMemberId,
    balanceCents: family.balanceCents,
    sharedCards,
    members: family.members.map((fm) => ({
      id: fm.id,
      memberId: fm.memberId,
      role: fm.role,
      isPrimary: fm.isPrimary,
      firstName: fm.member.firstName,
      lastName: fm.member.lastName,
      email: fm.member.email,
      phone: fm.member.phone,
      status: fm.member.status,
      photoUrl: fm.member.photoUrl,
      dob: fm.member.dob,
      subscription: fm.member.membershipSubscriptions[0]
        ? { planName: fm.member.membershipSubscriptions[0].plan.name, status: fm.member.membershipSubscriptions[0].status }
        : null,
      hasSharedCard: sharedCards.some((c) => c.memberId === fm.memberId),
    })),
  };
}
