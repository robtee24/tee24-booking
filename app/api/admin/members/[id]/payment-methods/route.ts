import { NextRequest, NextResponse } from "next/server";
import { assertCan } from "@/lib/permissions";
import { listPaymentMethods, setDefaultPaymentMethod } from "@/services/billing.service";
import { apiError, readJson, requireMemberApi } from "../../_shared";

export const dynamic = "force-dynamic";

/** GET /api/admin/members/[id]/payment-methods — permission billing.view */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "billing.view", { locationId: g.member.locationId });
    return NextResponse.json({ paymentMethods: await listPaymentMethods(id) });
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/admin/members/[id]/payment-methods { paymentMethodId, action: "default" } — permission billing.change-payment-method */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "billing.change-payment-method", { locationId: g.member.locationId });
    const body = await readJson(req);
    if (!body.paymentMethodId) return NextResponse.json({ error: "paymentMethodId required" }, { status: 400 });
    const methods = await listPaymentMethods(id);
    if (!methods.some((m) => m.id === body.paymentMethodId)) return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    await setDefaultPaymentMethod(id, String(body.paymentMethodId), g.admin.id);
    return NextResponse.json({ ok: true, paymentMethods: await listPaymentMethods(id) });
  } catch (e) {
    return apiError(e);
  }
}
