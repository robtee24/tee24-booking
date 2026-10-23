// PATCH /api/admin/memberships/:id — edit plan fields that don't affect billing
// (visit allowance enforced by the member app's door unlock, description).
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { audit, diff } from "@/lib/audit";
import { apiError } from "@/app/api/admin/members/_shared";

export const dynamic = "force-dynamic";

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
  const body = (await req.json().catch(() => ({}))) as { visitsPerPeriod?: number | string | null; visitPeriod?: string; description?: string | null };
  const prisma = getPrisma();
  const before = await prisma.membershipPlan.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const data: { visitsPerPeriod?: number | null; visitPeriod?: string; description?: string | null } = {};
  if ("visitsPerPeriod" in body) {
    const n = body.visitsPerPeriod == null || body.visitsPerPeriod === "" ? null : Number(body.visitsPerPeriod);
    if (n != null && (!Number.isInteger(n) || n < 1 || n > 365)) return NextResponse.json({ error: "visitsPerPeriod must be a whole number between 1 and 365" }, { status: 400 });
    data.visitsPerPeriod = n;
  }
  if ("visitPeriod" in body) {
    if (body.visitPeriod !== "ROLLING_MONTH" && body.visitPeriod !== "ROLLING_WEEK") return NextResponse.json({ error: "visitPeriod must be ROLLING_MONTH or ROLLING_WEEK" }, { status: 400 });
    data.visitPeriod = body.visitPeriod;
  }
  if ("description" in body) data.description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) || null : null;

  const plan = await prisma.membershipPlan.update({ where: { id }, data });
  const d = diff(before as Record<string, unknown>, plan as Record<string, unknown>);
  void audit({ organizationId: plan.organizationId, actorId: guard.admin.id, action: "membership.edit", entityType: "MembershipPlan", entityId: id, before: d.before, after: d.after });
  return NextResponse.json({ plan });
}
