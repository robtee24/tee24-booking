/**
 * POST /api/admin/billing/charges { invoiceId, paymentMethodId?, amountCents?, note? }
 *   → charge a card on file (default card when paymentMethodId omitted)   (billing.charge)
 */
import { NextRequest, NextResponse } from "next/server";
import { chargeInvoiceWithDefaultCard, runCharge } from "@/services/billing.service";
import { errorResponse, guardInvoice } from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.invoiceId) return NextResponse.json({ error: "invoiceId required" }, { status: 400 });
  const g = await guardInvoice(String(body.invoiceId), "billing.charge");
  if (!g.ok) return g.response;
  try {
    const charge = body.paymentMethodId
      ? await runCharge({
          invoiceId: g.invoiceId,
          paymentMethodId: String(body.paymentMethodId),
          amountCents: body.amountCents != null ? Math.round(Number(body.amountCents)) : undefined,
          note: body.note,
          actorId: g.actorId,
        })
      : await chargeInvoiceWithDefaultCard(g.invoiceId, g.actorId);
    return NextResponse.json({ ok: true, charge });
  } catch (e) {
    return errorResponse(e);
  }
}
