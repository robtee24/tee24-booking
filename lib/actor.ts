// lib/actor.ts
// Build the permission-aware ActorContext for the signed-in admin so API
// routes can call `assertCan(actor, "billing.refund", { locationId })`.
import { getPrisma } from "@/lib/db";
import { getCurrentAdmin } from "@/lib/access";
import type { ActorContext } from "@/lib/permissions";

export async function getActorContext(): Promise<ActorContext | null> {
  const admin = await getCurrentAdmin();
  if (!admin) return null;
  const grants = await getPrisma().adminPermission.findMany({
    where: { adminId: admin.id },
    select: { permission: true, locationId: true },
  });
  return {
    id: admin.id,
    role: admin.role,
    permissionGrants: grants,
    locationIds: admin.locations.map((l) => l.locationId),
  };
}
