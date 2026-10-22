/**
 * POST /api/admin/discounts/validate { locationSlug, code, planId?, memberId?, signupFormId?, subtotalCents? }
 *   → { ok, discount?, amountCents?, reason? }   (billing.view)
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { computeDiscountCents, describeDiscount, validateDiscount } from "@/services/discount.service";
import { guardBilling } from "../../billing/_shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const g = await guardBilling({ locationSlug: body.locationSlug, locationId: body.locationId }, "billing.view");
  if (!g.ok) return g.response;
  const loc = await getPrisma().location.findUnique({ where: { id: g.location.id }, select: { organizationId: true } });
  const r = await validateDiscount(String(body.code ?? ""), {
    planId: body.planId ?? null,
    memberId: body.memberId ?? null,
    signupFormId: body.signupFormId ?? null,
    organizationId: loc?.organizationId ?? null,
  });
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason });
  const subtotal = Number(body.subtotalCents ?? 0);
  return NextResponse.json({
    ok: true,
    discount: { id: r.discount.id, code: r.discount.code, name: r.discount.name, description: describeDiscount(r.discount) },
    amountCents: subtotal > 0 ? computeDiscountCents(r.discount, subtotal) : null,
  });
}
