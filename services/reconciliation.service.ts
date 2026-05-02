/**
 * Reconciliation jobs — detect & self-heal drift between our state and external systems.
 *
 *  - Kisi access: every active member should match `computeDesiredAccessState`
 *  - Square subscriptions: status mirroring (deferred until Square subscription
 *    sync is fully wired)
 */
import { getPrisma } from "@/lib/db";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";

export async function reconcileAllMemberAccess() {
  const prisma = getPrisma();
  const members = await prisma.member.findMany({
    where: { status: { in: ["ACTIVE", "FROZEN", "PENDING", "VISITOR"] } },
    select: { id: true, kisiAccessEnabled: true },
  });

  let drifted = 0;
  let healed = 0;
  for (const m of members) {
    const desired = await computeDesiredAccessState(m.id);
    if (desired.enabled !== m.kisiAccessEnabled) {
      drifted++;
      await applyAccessState(m.id, desired).catch((e) => console.warn("[reconcile] apply failed", m.id, e));
      healed++;
    }
  }

  return { checked: members.length, drifted, healed };
}
