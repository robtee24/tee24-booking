/**
 * GET   /api/admin/billing/settings?locationSlug=   → billing settings + Square status  (billing.view)
 * PATCH /api/admin/billing/settings                 → update settings                   (billing.configure)
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { billingSettingsOf, updateBillingSettings } from "@/services/billing.service";
import { errorResponse, guardBilling, squareStatusPayload } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardBilling({ locationSlug: req.nextUrl.searchParams.get("locationSlug") }, "billing.view");
  if (!g.ok) return g.response;
  const loc = await getPrisma().location.findUnique({ where: { id: g.location.id } });
  if (!loc) return NextResponse.json({ error: "Location not found" }, { status: 404 });
  return NextResponse.json({ settings: billingSettingsOf(loc), square: squareStatusPayload() });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const g = await guardBilling({ locationSlug: body.locationSlug, locationId: body.locationId }, "billing.configure");
  if (!g.ok) return g.response;
  try {
    const settings = await updateBillingSettings(
      g.location.id,
      {
        currency: body.currency,
        taxRateBps: body.taxRateBps,
        cardSurchargeBps: body.cardSurchargeBps,
        dunningRetryDays: body.dunningRetryDays,
        lateFeeCents: body.lateFeeCents,
        overdueBlockDays: body.overdueBlockDays,
      },
      g.actorId,
    );
    return NextResponse.json({ ok: true, settings, square: squareStatusPayload() });
  } catch (e) {
    return errorResponse(e);
  }
}
