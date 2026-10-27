import { NextRequest, NextResponse } from "next/server";
import { assertCan } from "@/lib/permissions";
import { applyChange, listSelfServicePlans, previewChange } from "@/services/portal-membership.service";
import { apiError, readJson } from "@/app/api/admin/members/_shared";
import { requireSubscriptionApi } from "../_guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/memberships/[id]/change-plan?planId=&guestCount=
 * Live preview (same engine as the clubhouse). Staff can apply even while MIGRATION_FREEZE is on.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireSubscriptionApi(id);
  if (!g.ok) return g.response;
  try {
    const sp = req.nextUrl.searchParams;
    const planId = sp.get("planId") || null;
    const guestCount = Number(sp.get("guestCount") ?? 0);
    const [{ plans }, preview] = await Promise.all([
      listSelfServicePlans(g.sub.memberId),
      previewChange(g.sub.memberId, { planId, guestCount: Number.isFinite(guestCount) ? guestCount : 0 }),
    ]);
    return NextResponse.json({ ok: true, preview, plans });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST /api/admin/memberships/[id]/change-plan { newPlanId | planId, guestCount }
 * Upgrades charge the prorated difference now; downgrades schedule for the next renewal.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireSubscriptionApi(id);
  if (!g.ok) return g.response;
  const body = await readJson(req);
  try {
    assertCan(g.actor, "membership.subscribe", { locationId: g.sub.locationId });
    const planId = String(body.newPlanId ?? body.planId ?? "");
    if (!planId) return NextResponse.json({ error: "newPlanId required" }, { status: 400 });
    const guestCount = body.guestCount === undefined || body.guestCount === null || body.guestCount === "" ? 0 : Number(body.guestCount);
    if (!Number.isInteger(guestCount) || guestCount < 0) return NextResponse.json({ error: "guestCount must be a whole number" }, { status: 400 });
    const result = await applyChange(g.sub.memberId, { planId, guestCount }, { force: true, actorId: g.admin.id });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return apiError(e);
  }
}
