/**
 * Member merge — detect duplicate records (same email or same normalized phone
 * within a location) and fold one or more "losers" into a survivor.
 *
 * Merging re-points every child relation to the survivor, fills blank survivor
 * fields from the loser, appends the loser's contact details as secondaries,
 * sets `mergedIntoId` + status MERGED on the loser and writes an audit entry.
 * Loser rows are kept (not deleted) so external ids (gymDeskId, Square, Kisi)
 * remain traceable.
 */
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";

export type DuplicateMember = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  joinDate: Date | null;
  createdAt: Date;
  photoUrl: string | null;
  membershipType: string | null;
  counts: { visits: number; invoices: number; subscriptions: number; documents: number; notes: number };
  lastVisitAt: Date | null;
};

export type DuplicateGroup = { key: string; reason: "email" | "phone"; members: DuplicateMember[] };

export function normalizePhone(p: string | null | undefined): string {
  const d = (p ?? "").replace(/\D/g, "");
  if (!d) return "";
  return d.length > 10 ? d.slice(-10) : d;
}

export async function findDuplicateGroups(locationId: string): Promise<DuplicateGroup[]> {
  const prisma = getPrisma();
  const members = await prisma.member.findMany({
    where: { locationId, status: { not: "MERGED" } },
    select: {
      id: true, firstName: true, lastName: true, email: true, phone: true, status: true, joinDate: true, createdAt: true, photoUrl: true, membershipType: true,
      secondaryEmails: true, secondaryPhones: true,
      _count: { select: { visits: true, invoices: true, membershipSubscriptions: true, documentAssignments: true, notes: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const byEmail = new Map<string, typeof members>();
  const byPhone = new Map<string, typeof members>();
  for (const m of members) {
    const emails = new Set<string>([m.email.toLowerCase().trim(), ...((m.secondaryEmails as string[] | null) ?? []).map((e) => e.toLowerCase().trim())].filter(Boolean));
    for (const e of emails) byEmail.set(e, [...(byEmail.get(e) ?? []), m]);
    const phones = new Set<string>([normalizePhone(m.phone), ...((m.secondaryPhones as string[] | null) ?? []).map(normalizePhone)].filter((p) => p.length >= 7));
    for (const p of phones) byPhone.set(p, [...(byPhone.get(p) ?? []), m]);
  }

  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>();
  const push = (key: string, reason: "email" | "phone", list: typeof members) => {
    const uniq = Array.from(new Map(list.map((m) => [m.id, m])).values());
    if (uniq.length < 2) return;
    const sig = uniq.map((m) => m.id).sort().join("|");
    if (seen.has(sig)) return;
    seen.add(sig);
    groups.push({ key, reason, members: uniq.map((m) => ({
      id: m.id, firstName: m.firstName, lastName: m.lastName, email: m.email, phone: m.phone, status: m.status, joinDate: m.joinDate, createdAt: m.createdAt,
      photoUrl: m.photoUrl, membershipType: m.membershipType,
      counts: { visits: m._count.visits, invoices: m._count.invoices, subscriptions: m._count.membershipSubscriptions, documents: m._count.documentAssignments, notes: m._count.notes },
      lastVisitAt: null,
    })) });
  };
  for (const [k, list] of byEmail) push(k, "email", list);
  for (const [k, list] of byPhone) push(k, "phone", list);

  // last visit per member in any group
  const ids = groups.flatMap((g) => g.members.map((m) => m.id));
  if (ids.length) {
    const agg = await prisma.visit.groupBy({ by: ["memberId"], where: { memberId: { in: ids } }, _max: { enteredAt: true } });
    const lv = new Map(agg.map((a) => [a.memberId, a._max.enteredAt]));
    for (const g of groups) for (const m of g.members) m.lastVisitAt = lv.get(m.id) ?? null;
  }
  return groups;
}

export async function mergeMembers(opts: { survivorId: string; loserIds: string[]; actorId?: string }) {
  const prisma = getPrisma();
  const losers = opts.loserIds.filter((id) => id !== opts.survivorId);
  if (losers.length === 0) throw new Error("Nothing to merge");

  const survivor = await prisma.member.findUnique({ where: { id: opts.survivorId }, include: { family: true, paypalAccount: true } });
  if (!survivor) throw new Error("Survivor not found");

  const moved: Record<string, number> = {};
  const bump = (k: string, n: number) => { moved[k] = (moved[k] ?? 0) + n; };

  for (const loserId of losers) {
    const loser = await prisma.member.findUnique({ where: { id: loserId }, include: { memberTags: true, customFieldValues: true, family: true, paypalAccount: true } });
    if (!loser) continue;
    if (loser.locationId !== survivor.locationId) throw new Error("Members must belong to the same location");
    if (loser.status === "MERGED") continue;

    await prisma.$transaction(async (tx) => {
      // Simple re-points
      bump("invoices", (await tx.invoice.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } })).count);
      bump("charges", (await tx.charge.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } })).count);
      bump("visits", (await tx.visit.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } })).count);
      bump("subscriptions", (await tx.membershipSubscription.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } })).count);
      bump("documents", (await tx.documentAssignment.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } })).count);
      await tx.signatureEvent.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } });
      bump("notes", (await tx.memberNote.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } })).count);
      bump("internalNotes", (await tx.internalNote.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } })).count);
      bump("conversations", (await tx.conversation.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } })).count);
      bump("messages", (await tx.message.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } })).count);
      bump("credits", (await tx.memberCredit.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } })).count);
      bump("paymentMethods", (await tx.paymentMethod.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id, isDefault: false } })).count);
      await tx.emergencyContact.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } });
      await tx.automationEnrollment.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } }).catch(() => undefined);
      await tx.usageTierSnapshot.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } });
      await tx.churnRiskScore.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } });
      await tx.member.updateMany({ where: { referredById: loserId }, data: { referredById: survivor.id } });
      await tx.booking.updateMany({ where: { memberId: loserId }, data: { memberId: survivor.id } });

      // Tags (unique memberId+tagId)
      const survivorTagIds = new Set((await tx.memberTag.findMany({ where: { memberId: survivor.id }, select: { tagId: true } })).map((t) => t.tagId));
      for (const t of loser.memberTags) {
        if (survivorTagIds.has(t.tagId)) await tx.memberTag.delete({ where: { id: t.id } });
        else { await tx.memberTag.update({ where: { id: t.id }, data: { memberId: survivor.id } }); bump("tags", 1); }
      }
      // Custom field values (unique fieldId+memberId)
      const survivorFieldIds = new Set((await tx.customFieldValue.findMany({ where: { memberId: survivor.id }, select: { fieldId: true } })).map((v) => v.fieldId));
      for (const v of loser.customFieldValues) {
        if (survivorFieldIds.has(v.fieldId)) await tx.customFieldValue.delete({ where: { id: v.id } });
        else await tx.customFieldValue.update({ where: { id: v.id }, data: { memberId: survivor.id } });
      }
      // Family link (unique memberId)
      if (loser.family) {
        if (survivor.family) await tx.familyMember.delete({ where: { id: loser.family.id } });
        else await tx.familyMember.update({ where: { id: loser.family.id }, data: { memberId: survivor.id } });
        await tx.familyAccount.updateMany({ where: { primaryMemberId: loserId }, data: { primaryMemberId: survivor.family ? survivor.id : survivor.id } }).catch(() => undefined);
      }
      // PayPal (unique memberId)
      if (loser.paypalAccount && !survivor.paypalAccount) {
        await tx.paypalAccount.update({ where: { id: loser.paypalAccount.id }, data: { memberId: survivor.id } });
      }
      // Visitor link (unique convertedToMemberId): only move if survivor has none
      const survivorVisitor = await tx.visitor.findFirst({ where: { convertedToMemberId: survivor.id }, select: { id: true } });
      if (!survivorVisitor) await tx.visitor.updateMany({ where: { convertedToMemberId: loserId }, data: { convertedToMemberId: survivor.id } });
      else await tx.visitor.updateMany({ where: { convertedToMemberId: loserId }, data: { convertedToMemberId: null } });

      // Fill blanks on survivor + collect secondaries
      const secEmails = new Set<string>([...((survivor.secondaryEmails as string[] | null) ?? []), ...((loser.secondaryEmails as string[] | null) ?? [])]);
      if (loser.email && loser.email.toLowerCase() !== survivor.email.toLowerCase()) secEmails.add(loser.email.toLowerCase());
      const secPhones = new Set<string>([...((survivor.secondaryPhones as string[] | null) ?? []), ...((loser.secondaryPhones as string[] | null) ?? [])]);
      if (loser.phone && normalizePhone(loser.phone) !== normalizePhone(survivor.phone)) secPhones.add(loser.phone);
      secEmails.delete(survivor.email.toLowerCase());

      const fill: Prisma.MemberUpdateInput = {
        secondaryEmails: Array.from(secEmails),
        secondaryPhones: Array.from(secPhones),
        dob: survivor.dob ?? loser.dob ?? undefined,
        gender: survivor.gender ?? loser.gender ?? undefined,
        photoUrl: survivor.photoUrl ?? loser.photoUrl ?? undefined,
        addressLine1: survivor.addressLine1 ?? loser.addressLine1 ?? undefined,
        addressLine2: survivor.addressLine2 ?? loser.addressLine2 ?? undefined,
        city: survivor.city ?? loser.city ?? undefined,
        state: survivor.state ?? loser.state ?? undefined,
        zip: survivor.zip ?? loser.zip ?? undefined,
        gymDeskId: survivor.gymDeskId ?? loser.gymDeskId ?? undefined,
        squareCustomerId: survivor.squareCustomerId ?? loser.squareCustomerId ?? undefined,
        kisiUserId: survivor.kisiUserId ?? loser.kisiUserId ?? undefined,
        guardianName: survivor.guardianName ?? loser.guardianName ?? undefined,
        acquisitionSource: survivor.acquisitionSource ?? loser.acquisitionSource ?? undefined,
        membershipType: survivor.membershipType ?? loser.membershipType ?? undefined,
        joinDate: survivor.joinDate && loser.joinDate ? (loser.joinDate < survivor.joinDate ? loser.joinDate : survivor.joinDate) : survivor.joinDate ?? loser.joinDate ?? undefined,
        smsConsentAt: survivor.smsConsentAt ?? loser.smsConsentAt ?? undefined,
        smsConsentSource: survivor.smsConsentSource ?? loser.smsConsentSource ?? undefined,
        optInSmsMarketing: survivor.optInSmsMarketing || loser.optInSmsMarketing,
      };
      // If survivor is a visitor/pending and loser was an active member, prefer the stronger status
      const rank: Record<string, number> = { ACTIVE: 5, FROZEN: 4, PENDING: 3, CANCELLED: 2, VISITOR: 1 };
      if ((rank[loser.status] ?? 0) > (rank[survivor.status] ?? 0)) fill.status = loser.status;

      await tx.member.update({ where: { id: survivor.id }, data: fill });

      // Retire the loser (free unique code / referral code / family id)
      await tx.member.update({
        where: { id: loserId },
        data: { status: "MERGED", mergedIntoId: survivor.id, checkinCode: null, familyAccountId: null, kisiAccessEnabled: false, kisiAccessReason: `Merged into ${survivor.id}` },
      });
    });

    void audit({
      organizationId: survivor.organizationId,
      actorId: opts.actorId,
      action: "member.update",
      entityType: "Member",
      entityId: survivor.id,
      metadata: { event: "member.merged", loserId, moved },
    });
    void audit({
      organizationId: survivor.organizationId,
      actorId: opts.actorId,
      action: "member.status-change",
      entityType: "Member",
      entityId: loserId,
      before: { status: loser.status },
      after: { status: "MERGED", mergedIntoId: survivor.id },
    });
  }

  return { survivorId: survivor.id, merged: losers, moved };
}
