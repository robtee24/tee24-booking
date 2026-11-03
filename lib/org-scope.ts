// lib/org-scope.ts
// Permission checks for ORG-level entities (membership plans, document
// templates) that have an organizationId but no locationId.
//
// FULL/ROOT: always allowed.
// SCOPED:    allowed when they hold `permission` for at least one of their
//            assigned locations inside that organization. Entities with no
//            organization (global) require an org-wide (locationId = null) grant.
import { getPrisma } from "@/lib/db";
import { isFullAccess } from "@/lib/access";
import { can, ForbiddenError, type ActorContext, type Permission } from "@/lib/permissions";

export async function canInOrg(
  actor: ActorContext | null,
  permission: Permission,
  organizationId: string | null | undefined,
): Promise<boolean> {
  if (!actor) return false;
  if (isFullAccess(actor.role)) return true;
  if (!organizationId) return can(actor, permission, {});
  const ids = actor.locationIds ?? [];
  if (ids.length === 0) return false;
  const locs = await getPrisma().location.findMany({
    where: { id: { in: ids }, organizationId },
    select: { id: true },
  });
  return locs.some((l) => can(actor, permission, { locationId: l.id }));
}

export async function assertCanInOrg(
  actor: ActorContext | null,
  permission: Permission,
  organizationId: string | null | undefined,
): Promise<void> {
  if (!(await canInOrg(actor, permission, organizationId))) throw new ForbiddenError(permission, {});
}
