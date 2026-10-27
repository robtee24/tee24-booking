/**
 * Reconciliation jobs — detect & self-heal drift between our state and external systems.
 *
 *  - Kisi access (local): every member's mirror should match `computeDesiredAccessState`.
 *  - Kisi access (remote): nobody should exist in the Kisi organization unless they are
 *    a Tee24 member whose door access is on (or Tee24 staff). Anyone else is an orphan
 *    left behind by GymDesk-era shares and is deleted; unknown emails are only reported.
 *  - Square subscriptions: status mirroring (deferred until Square subscription
 *    sync is fully wired)
 */
import { getPrisma } from "@/lib/db";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";
import { kisiConfigured, kisiDeleteMember, kisiListAllMembers } from "@/lib/kisi";
import { adminNotify } from "@/lib/admin-notify";
import { audit } from "@/lib/audit";
import { isMigrationFrozen } from "@/lib/migration-freeze";

export async function reconcileAllMemberAccess() {
  const prisma = getPrisma();
  const members = await prisma.member.findMany({
    where: { status: { in: ["ACTIVE", "FROZEN", "PENDING", "VISITOR", "CANCELLED"] } },
    select: { id: true, kisiAccessEnabled: true, kisiUserId: true },
  });

  let drifted = 0;
  let healed = 0;
  for (const m of members) {
    const desired = await computeDesiredAccessState(m.id);
    // Drift = mirror disagrees, or access is off but a Kisi identity is still attached.
    if (desired.enabled !== m.kisiAccessEnabled || (!desired.enabled && m.kisiUserId)) {
      drifted++;
      await applyAccessState(m.id, desired).catch((e) => console.warn("[reconcile] apply failed", m.id, e));
      healed++;
    }
  }

  const remote = await reconcileKisiOrphans().catch((e) => {
    console.warn("[reconcile] kisi orphan sweep failed", e);
    return { scanned: 0, deleted: 0, unknown: 0, skippedStaff: 0 };
  });

  return { checked: members.length, drifted, healed, kisi: remote };
}

/**
 * Walk the Kisi organization member list and remove anyone who maps to a Tee24
 * member without door access. Staff (Admin accounts) and emails we don't know
 * are never deleted — unknowns are surfaced to the admin inbox for review.
 */
export async function reconcileKisiOrphans(opts: { dryRun?: boolean } = {}) {
  const prisma = getPrisma();
  if (!kisiConfigured() || isMigrationFrozen()) return { scanned: 0, deleted: 0, unknown: 0, skippedStaff: 0 };

  const kisiMembers = await kisiListAllMembers();
  const staffEmails = new Set((await prisma.admin.findMany({ select: { email: true } })).map((a) => (a.email ?? "").toLowerCase()).filter(Boolean));

  let deleted = 0;
  let skippedStaff = 0;
  const unknown: string[] = [];
  const removed: string[] = [];

  for (const km of kisiMembers) {
    const email = (km.email ?? "").toLowerCase();
    const userId = km.user_id != null ? String(km.user_id) : null;
    if (email && staffEmails.has(email)) { skippedStaff++; continue; }

    const member =
      (userId ? await prisma.member.findFirst({ where: { kisiUserId: userId }, select: { id: true, kisiAccessEnabled: true, firstName: true, lastName: true, email: true, organizationId: true, locationId: true } }) : null) ??
      (email ? await prisma.member.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, orderBy: { kisiAccessEnabled: "desc" }, select: { id: true, kisiAccessEnabled: true, firstName: true, lastName: true, email: true, organizationId: true, locationId: true } }) : null);

    if (!member) { if (email) unknown.push(email); continue; }
    if (member.kisiAccessEnabled) continue; // legitimately in Kisi

    if (opts.dryRun) { removed.push(`${member.firstName} ${member.lastName} <${email}>`); deleted++; continue; }
    try {
      await kisiDeleteMember({ userId: km.user_id ?? km.id, email });
      await prisma.member.updateMany({ where: { id: member.id, kisiUserId: userId ?? undefined }, data: { kisiUserId: null } });
      if (userId) {
        const existing = await prisma.memberKisiLink.findFirst({ where: { memberId: member.id, kisiUserId: userId, unlinkedAt: null } });
        if (existing) await prisma.memberKisiLink.update({ where: { id: existing.id }, data: { unlinkedAt: new Date(), unlinkReason: "Reconciliation: no door access", kisiMemberId: String(km.id) } });
        else await prisma.memberKisiLink.create({ data: { memberId: member.id, kisiUserId: userId, kisiMemberId: String(km.id), email, unlinkedAt: new Date(), unlinkReason: "Reconciliation: no door access" } });
      }
      void audit({ organizationId: member.organizationId, action: "kisi.access-disable", entityType: "Member", entityId: member.id, metadata: { trigger: "reconcile-orphan", kisiUserId: userId, kisiMemberId: km.id } });
      removed.push(`${member.firstName} ${member.lastName} <${email}>`);
      deleted++;
    } catch (e) {
      console.warn("[reconcile] kisi delete failed", member.id, e);
    }
  }

  if (!opts.dryRun && (deleted > 0 || unknown.length > 0)) {
    void adminNotify({
      organizationId: null,
      kind: "integration.alert",
      severity: unknown.length ? "WARN" : "INFO",
      title: `Kisi sweep: removed ${deleted} orphaned ${deleted === 1 ? "user" : "users"}${unknown.length ? `, ${unknown.length} unknown` : ""}`,
      body: [
        removed.length ? `Removed (no door access in Tee24): ${removed.slice(0, 25).join(", ")}${removed.length > 25 ? ` +${removed.length - 25} more` : ""}` : null,
        unknown.length ? `In Kisi but not in Tee24 (left alone — review): ${unknown.slice(0, 25).join(", ")}${unknown.length > 25 ? ` +${unknown.length - 25} more` : ""}` : null,
      ].filter(Boolean).join("\n"),
      link: "/admin/door-access",
      data: { deleted, unknown: unknown.slice(0, 100) },
    });
  }

  return { scanned: kisiMembers.length, deleted, unknown: unknown.length, skippedStaff, removed, unknownEmails: unknown };
}
