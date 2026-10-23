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
import { assertCan } from "@/lib/permissions";
import { audit, diff } from "@/lib/audit";
import { apiError } from "@/app/api/admin/members/_shared";
import { parsePlanBody, PlanInputError } from "@/lib/admin/plan-input";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const plan = await getPrisma().membershipPlan.findUnique({ where: { id }, include: { _count: { select: { subscriptions: { where: { status: { in: ["ACTIVE", "FROZEN", "CANCEL_SCHEDULED", "FREEZE_SCHEDULED", "PENDING"] } } } } } } });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  return NextResponse.json({ plan });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const actor = await getActorContext();
  try {
    assertCan(actor, "membership.edit");
  } catch (e) {
    return apiError(e);
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const prisma = getPrisma();
  const before = await prisma.membershipPlan.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

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
