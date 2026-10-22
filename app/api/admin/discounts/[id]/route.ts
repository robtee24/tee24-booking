/**
 * GET    /api/admin/discounts/[id]?locationSlug=  → discount + usage          (billing.view)
 * PATCH  /api/admin/discounts/[id]  { locationSlug, ...fields }               (discount.edit)
 * DELETE /api/admin/discounts/[id]?locationSlug=  → deactivate (soft)         (discount.edit)
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getDiscountUsage, setDiscountActive, updateDiscount } from "@/services/discount.service";
import { errorResponse, guardBilling } from "../../billing/_shared";
import { discountBodyToInput } from "../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardBilling({ locationSlug: req.nextUrl.searchParams.get("locationSlug") }, "billing.view");
  if (!g.ok) return g.response;
  const discount = await getPrisma().discount.findUnique({ where: { id }, include: { planRestrictions: { include: { plan: { select: { id: true, name: true } } } } } });
  if (!discount) return NextResponse.json({ error: "Discount not found" }, { status: 404 });
  const usage = await getDiscountUsage(id);
  return NextResponse.json({ discount, usage });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const g = await guardBilling({ locationSlug: body.locationSlug, locationId: body.locationId }, "discount.edit");
  if (!g.ok) return g.response;
  try {
    const input = discountBodyToInput(body);
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const discount = await updateDiscount(id, patch, g.actorId);
    return NextResponse.json({ ok: true, discount });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardBilling({ locationSlug: req.nextUrl.searchParams.get("locationSlug") }, "discount.edit");
  if (!g.ok) return g.response;
  try {
    const discount = await setDiscountActive(id, false, g.actorId);
    return NextResponse.json({ ok: true, discount });
  } catch (e) {
    return errorResponse(e);
  }
}
