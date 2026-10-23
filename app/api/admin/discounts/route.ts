/**
 * GET  /api/admin/discounts?locationSlug=   → list discounts for the location's org   (billing.view)
 * POST /api/admin/discounts { locationSlug, code, name, type, value, scope, recurringMonths?, maxRedemptions?, perMemberLimit?, startsAt?, endsAt?, active?, signupFormIds?, planIds? }
 *                                            → create                                 (discount.create)
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { createDiscount, listDiscounts } from "@/services/discount.service";
import { errorResponse, guardBilling } from "../billing/_shared";
import { discountBodyToInput } from "./_shared";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardBilling({ locationSlug: req.nextUrl.searchParams.get("locationSlug") }, "billing.view");
  if (!g.ok) return g.response;
  const loc = await getPrisma().location.findUnique({ where: { id: g.location.id }, select: { organizationId: true } });
  const discounts = await listDiscounts(loc?.organizationId);
  return NextResponse.json({ discounts });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const g = await guardBilling({ locationSlug: body.locationSlug, locationId: body.locationId }, "discount.create");
  if (!g.ok) return g.response;
  try {
    const loc = await getPrisma().location.findUnique({ where: { id: g.location.id }, select: { organizationId: true } });
    const input = discountBodyToInput(body);
    const discount = await createDiscount(
      {
        organizationId: loc?.organizationId ?? null,
        code: String(input.code ?? ""),
        name: String(input.name ?? ""),
        type: input.type ?? "PERCENT",
        value: Number(input.value ?? 0),
        scope: input.scope ?? "ONE_TIME",
        recurringMonths: input.recurringMonths ?? null,
        maxRedemptions: input.maxRedemptions ?? null,
        perMemberLimit: input.perMemberLimit ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        active: input.active ?? true,
        signupFormIds: input.signupFormIds ?? null,
        planIds: input.planIds ?? null,
        showOnSignup: input.showOnSignup,
        signupTitle: input.signupTitle,
        signupDescription: input.signupDescription,
        requiresIdUpload: input.requiresIdUpload,
        idUploadLabel: input.idUploadLabel,
        commitmentMonths: input.commitmentMonths,
        commitmentAcknowledgement: input.commitmentAcknowledgement,
        earlyCancelPolicy: input.earlyCancelPolicy,
        sortOrder: input.sortOrder,
      },
      g.actorId,
    );
    return NextResponse.json({ ok: true, discount });
  } catch (e) {
    return errorResponse(e);
  }
}
