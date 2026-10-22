/**
 * POST /api/admin/billing/refunds { chargeId, amountCents, reason?, asCredit? }   (billing.refund)
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { refundCharge } from "@/services/billing.service";
import { errorResponse, guardBilling } from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.chargeId || !body.amountCents) {
    return NextResponse.json({ error: "chargeId and amountCents required" }, { status: 400 });
  }
  const charge = await getPrisma().charge.findUnique({ where: { id: String(body.chargeId) }, select: { locationId: true, member: { select: { locationId: true } } } });
  if (!charge) return NextResponse.json({ error: "Charge not found" }, { status: 404 });
  const locationId = charge.locationId ?? charge.member?.locationId ?? null;
  const g = await guardBilling({ locationId }, "billing.refund");
  if (!g.ok) return g.response;
  try {
    const refund = await refundCharge({
      chargeId: String(body.chargeId),
      amountCents: Math.round(Number(body.amountCents)),
      reason: body.reason,
      asCredit: Boolean(body.asCredit),
      actorId: g.actorId,
    });
    return NextResponse.json({ ok: true, refund });
  } catch (e) {
    return errorResponse(e);
  }
}
