// Guard for /api/admin/memberships/[id]/* — resolves the subscription and runs
// the location admin check + actor context.
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { requireLocationAdminApi, type ApiAdmin } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import type { ActorContext } from "@/lib/permissions";

export type SubGuard =
  | {
      ok: true;
      admin: ApiAdmin;
      actor: ActorContext;
      sub: { id: string; memberId: string; locationId: string; status: string; planName: string; organizationId: string | null };
    }
  | { ok: false; response: NextResponse };

export async function requireSubscriptionApi(subscriptionId: string): Promise<SubGuard> {
  const sub = await getPrisma().membershipSubscription.findUnique({
    where: { id: subscriptionId },
    select: { id: true, memberId: true, locationId: true, status: true, plan: { select: { name: true } }, member: { select: { organizationId: true } } },
  });
  if (!sub) return { ok: false, response: NextResponse.json({ error: "Subscription not found" }, { status: 404 }) };
  const guard = await requireLocationAdminApi({ locationId: sub.locationId });
  if (!guard.ok) return { ok: false, response: guard.response };
  const actor = await getActorContext();
  if (!actor) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return {
    ok: true,
    admin: guard.admin,
    actor,
    sub: { id: sub.id, memberId: sub.memberId, locationId: sub.locationId, status: sub.status, planName: sub.plan.name, organizationId: sub.member.organizationId },
  };
}
