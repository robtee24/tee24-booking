import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { emitMemberEvent } from "@/lib/events";
import { refundCharge, addCredit } from "@/services/billing.service";
import { apiError, readJson, requireMemberApi, toCents } from "../../_shared";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/members/[id]/refunds { chargeId, amount | amountCents, reason?, asCredit?: boolean }
 * Permission billing.refund. `asCredit` issues account credit instead of a card refund (works for cash charges).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "billing.refund", { locationId: g.member.locationId });
    const body = await readJson(req);
    if (!body.chargeId) return NextResponse.json({ error: "chargeId required" }, { status: 400 });
    const charge = await getPrisma().charge.findFirst({ where: { id: String(body.chargeId), memberId: id } });
    if (!charge) return NextResponse.json({ error: "Charge not found" }, { status: 404 });
    const amountCents = body.amountCents != null ? Math.round(Number(body.amountCents)) : body.amount != null && body.amount !== "" ? toCents(body.amount) : charge.amountCents;
    if (!Number.isFinite(amountCents) || amountCents <= 0 || amountCents > charge.amountCents) return NextResponse.json({ error: "Invalid refund amount" }, { status: 400 });
    const reason = body.reason ? String(body.reason) : undefined;

    let refund: any = null;
    if (body.asCredit || !charge.squarePaymentId) {
      if (!body.asCredit) return NextResponse.json({ error: "This charge was not taken by card. Refund it as account credit instead." }, { status: 400 });
      refund = await addCredit({ memberId: id, amountCents, type: "REFUND_AS_CREDIT", reason: reason ?? `Refund of charge ${charge.id}`, actorId: g.admin.id });
    } else {
      refund = await refundCharge({ chargeId: charge.id, amountCents, reason, actorId: g.admin.id });
    }

    void emitMemberEvent("payment.refunded", {
      memberId: id, locationId: g.member.locationId, organizationId: g.member.organizationId, actorAdminId: g.admin.id,
      refs: { chargeId: charge.id, invoiceId: charge.invoiceId ?? undefined }, vars: { amountCents, reason: reason ?? null, asCredit: body.asCredit ? "yes" : "no" },
    });
    return NextResponse.json({ ok: true, refund });
  } catch (e) {
    return apiError(e);
  }
}
