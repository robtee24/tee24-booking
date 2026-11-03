// PATCH /api/admin/memberships/:id — edit a membership plan.
//
// Price / cadence changes affect NEW subscriptions and plan-change pricing
// only: existing subscriptions keep their snapshotted `priceCents`, so
// current members are never re-priced by editing a plan here.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { isFullAccess } from "@/lib/access";
import { assertCanInOrg } from "@/lib/org-scope";
import { audit, diff } from "@/lib/audit";
import { apiError } from "@/app/api/admin/members/_shared";
import { parsePlanBody, PlanInputError } from "@/lib/admin/plan-input";

export const dynamic = "force-dynamic";

/**
 * Plans are org-level. A SCOPED admin may read a plan when they manage any
 * location in the plan's organization, and edit it when they hold
 * `membership.edit` for one of those locations.
 */
async function planInScope(actor: Awaited<ReturnType<typeof getActorContext>>, organizationId: string | null) {
  if (!actor) return false;
  if (isFullAccess(actor.role)) return true;
  if (!organizationId) return true; // global plan: listed for every location; edits still need an org-wide grant
  const ids = actor.locationIds ?? [];
  if (ids.length === 0) return false;
  const n = await getPrisma().location.count({ where: { id: { in: ids }, organizationId } });
  return n > 0;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const plan = await getPrisma().membershipPlan.findUnique({ where: { id }, include: { _count: { select: { subscriptions: { where: { status: { in: ["ACTIVE", "FROZEN", "CANCEL_SCHEDULED", "FREEZE_SCHEDULED", "PENDING"] } } } } } } });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  const actor = await getActorContext();
  if (!(await planInScope(actor, plan.organizationId))) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  return NextResponse.json({ plan });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const actor = await getActorContext();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const prisma = getPrisma();
  const before = await prisma.membershipPlan.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  if (!(await planInScope(actor, before.organizationId))) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  try {
    await assertCanInOrg(actor, "membership.edit", before.organizationId);
  } catch (e) {
    return apiError(e);
  }

  let patch;
  try {
    patch = parsePlanBody(body);
  } catch (e) {
    if (e instanceof PlanInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const { dayPassGuestPricing, ...rest } = patch;
  const data: Prisma.MembershipPlanUpdateInput = { ...rest };
  if (dayPassGuestPricing !== undefined) data.dayPassGuestPricing = dayPassGuestPricing === null ? Prisma.JsonNull : dayPassGuestPricing;

  const plan = await prisma.membershipPlan.update({ where: { id }, data });
  const d = diff(before as Record<string, unknown>, plan as Record<string, unknown>);
  void audit({ organizationId: plan.organizationId, actorId: guard.admin.id, action: "membership.edit", entityType: "MembershipPlan", entityId: id, before: d.before, after: d.after });
  return NextResponse.json({ plan });
}
