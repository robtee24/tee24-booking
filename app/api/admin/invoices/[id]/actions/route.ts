/**
 * POST /api/admin/invoices/[id]/actions  { action, ...params }
 *
 *  action            params                                   permission
 *  charge            paymentMethodId? (default card)           billing.charge
 *  charge-nonce      sourceId, verificationToken?              billing.charge     (admin keyed-in card, not stored)
 *  mark-paid         method: CASH|CHECK|OTHER|CREDIT, amountCents?, note?   billing.charge
 *  write-off         reason?                                   billing.write-off
 *  refund            chargeId, amountCents, reason?, asCredit? billing.refund
 *  send-pay-link     message?                                  billing.view
 *  send-receipt      —                                         billing.view
 *  apply-discount    code                                      discount.apply
 *  add-line          description, unitCents, quantity?         billing.edit-invoice
 */
import { NextRequest, NextResponse } from "next/server";
import type { Permission } from "@/lib/permissions";
import {
  addInvoiceLine,
  chargeInvoiceWithDefaultCard,
  chargeInvoiceWithSource,
  markInvoicePaidManually,
  refundCharge,
  runCharge,
  sendPayLinkEmail,
  sendReceiptEmail,
  writeOffInvoice,
  type ManualPaymentMethod,
} from "@/services/billing.service";
import { applyDiscountCodeToInvoice } from "@/services/discount.service";
import { errorResponse, guardInvoice } from "../../../billing/_shared";

export const dynamic = "force-dynamic";

const PERMISSION_BY_ACTION: Record<string, Permission> = {
  charge: "billing.charge",
  "charge-nonce": "billing.charge",
  "mark-paid": "billing.charge",
  "write-off": "billing.write-off",
  refund: "billing.refund",
  "send-pay-link": "billing.view",
  "send-receipt": "billing.view",
  "apply-discount": "discount.apply",
  "add-line": "billing.edit-invoice",
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const permission = PERMISSION_BY_ACTION[action];
  if (!permission) return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
  const g = await guardInvoice(id, permission);
  if (!g.ok) return g.response;

  try {
    switch (action) {
      case "charge": {
        const charge = body.paymentMethodId
          ? await runCharge({ invoiceId: id, paymentMethodId: String(body.paymentMethodId), actorId: g.actorId })
          : await chargeInvoiceWithDefaultCard(id, g.actorId);
        return NextResponse.json({ ok: true, charge });
      }
      case "charge-nonce": {
        const r = await chargeInvoiceWithSource({ invoiceId: id, sourceId: String(body.sourceId ?? ""), verificationToken: body.verificationToken ?? null, actorId: g.actorId });
        return NextResponse.json({ ok: r.succeeded, charge: r.charge });
      }
      case "mark-paid": {
        const method = String(body.method ?? "CASH").toUpperCase() as ManualPaymentMethod;
        if (!["CASH", "CHECK", "OTHER", "CREDIT"].includes(method)) return NextResponse.json({ error: "Invalid method" }, { status: 400 });
        const charge = await markInvoicePaidManually({
          invoiceId: id,
          method,
          amountCents: body.amountCents != null ? Math.round(Number(body.amountCents)) : undefined,
          note: body.note ? String(body.note) : undefined,
          actorId: g.actorId,
        });
        return NextResponse.json({ ok: true, charge });
      }
      case "write-off": {
        const invoice = await writeOffInvoice(id, { reason: body.reason ? String(body.reason) : undefined, actorId: g.actorId });
        return NextResponse.json({ ok: true, invoice });
      }
      case "refund": {
        const refund = await refundCharge({
          chargeId: String(body.chargeId ?? ""),
          amountCents: Math.round(Number(body.amountCents)),
          reason: body.reason ? String(body.reason) : undefined,
          asCredit: Boolean(body.asCredit),
          actorId: g.actorId,
        });
        return NextResponse.json({ ok: true, refund });
      }
      case "send-pay-link": {
        const url = await sendPayLinkEmail(id, { message: body.message ? String(body.message) : undefined });
        return NextResponse.json({ ok: Boolean(url), payUrl: url });
      }
      case "send-receipt": {
        const sent = await sendReceiptEmail(id);
        return NextResponse.json({ ok: sent });
      }
      case "apply-discount": {
        const r = await applyDiscountCodeToInvoice(id, String(body.code ?? ""), g.actorId);
        return NextResponse.json({ ok: true, code: r.discount.code, amountCents: r.amountCents });
      }
      case "add-line": {
        const invoice = await addInvoiceLine(
          id,
          { description: String(body.description ?? "").trim(), unitCents: Math.round(Number(body.unitCents)), quantity: Math.max(1, Math.floor(Number(body.quantity ?? 1)) || 1) },
          g.actorId,
        );
        return NextResponse.json({ ok: true, invoice });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
