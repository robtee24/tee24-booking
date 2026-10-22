/**
 * GET    /api/admin/payment-methods?memberId=            → cards on file                       (billing.view)
 * POST   /api/admin/payment-methods { memberId, sourceId, verificationToken?, setDefault? }
 *                                                        → vault a tokenized card via Square    (billing.change-payment-method)
 * PATCH  /api/admin/payment-methods { id, action: "default" }                                  (billing.change-payment-method)
 * DELETE /api/admin/payment-methods?id=                  → disable at Square + remove locally   (billing.change-payment-method)
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { isSquareConfigured } from "@/lib/square";
import { listPaymentMethods, removePaymentMethod, setDefaultPaymentMethod, vaultCard } from "@/services/billing.service";
import { errorResponse, guardBilling } from "../billing/_shared";

export const dynamic = "force-dynamic";

async function memberLocation(memberId: string) {
  return getPrisma().member.findUnique({ where: { id: memberId }, select: { id: true, locationId: true } });
}

export async function GET(req: NextRequest) {
  const memberId = req.nextUrl.searchParams.get("memberId") ?? "";
  const member = await memberLocation(memberId);
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  const g = await guardBilling({ locationId: member.locationId }, "billing.view");
  if (!g.ok) return g.response;
  return NextResponse.json({ paymentMethods: await listPaymentMethods(memberId), squareConfigured: isSquareConfigured() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const member = await memberLocation(String(body.memberId ?? ""));
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  const g = await guardBilling({ locationId: member.locationId }, "billing.change-payment-method");
  if (!g.ok) return g.response;
  try {
    const pm = await vaultCard({
      memberId: member.id,
      sourceId: String(body.sourceId ?? ""),
      verificationToken: body.verificationToken ?? null,
      setDefault: body.setDefault === undefined ? undefined : Boolean(body.setDefault),
      actorId: g.actorId,
      source: "admin",
    });
    return NextResponse.json({ ok: true, paymentMethod: pm });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const pm = await getPrisma().paymentMethod.findUnique({ where: { id: String(body.id ?? "") }, include: { member: { select: { locationId: true } } } });
  if (!pm) return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
  const g = await guardBilling({ locationId: pm.member.locationId }, "billing.change-payment-method");
  if (!g.ok) return g.response;
  try {
    if (body.action === "default") await setDefaultPaymentMethod(pm.memberId, pm.id, g.actorId);
    else return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    return NextResponse.json({ ok: true, paymentMethods: await listPaymentMethods(pm.memberId) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const pm = await getPrisma().paymentMethod.findUnique({ where: { id }, include: { member: { select: { locationId: true } } } });
  if (!pm) return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
  const g = await guardBilling({ locationId: pm.member.locationId }, "billing.change-payment-method");
  if (!g.ok) return g.response;
  try {
    await removePaymentMethod(id, g.actorId);
    return NextResponse.json({ ok: true, paymentMethods: await listPaymentMethods(pm.memberId) });
  } catch (e) {
    return errorResponse(e);
  }
}
