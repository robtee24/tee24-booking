/**
 * Member portal — pay an open invoice.
 *
 * POST /api/portal/billing/pay { invoiceId, paymentMethodId? | sourceId?, verificationToken? }
 *   - paymentMethodId → charge a card on file
 *   - sourceId        → one-off card entry (not stored)
 *   - neither         → default card
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getMemberSession } from "@/lib/member-session";
import { chargeInvoiceWithDefaultCard, chargeInvoiceWithSource, runCharge } from "@/services/billing.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const s = await getMemberSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role === "IMPERSONATED") return NextResponse.json({ error: "Read-only while viewing as member" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const inv = await getPrisma().invoice.findFirst({ where: { id: String(body.invoiceId ?? ""), memberId: s.sub }, select: { id: true, status: true } });
  if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (!["SCHEDULED", "PAST_DUE", "FAILED"].includes(inv.status)) return NextResponse.json({ error: "Invoice is not payable" }, { status: 409 });
  try {
    if (body.sourceId) {
      const r = await chargeInvoiceWithSource({ invoiceId: inv.id, sourceId: String(body.sourceId), verificationToken: body.verificationToken ?? null });
      return NextResponse.json({ ok: r.succeeded, receiptUrl: r.receiptUrl });
    }
    if (body.paymentMethodId) {
      const pm = await getPrisma().paymentMethod.findFirst({ where: { id: String(body.paymentMethodId), memberId: s.sub } });
      if (!pm) return NextResponse.json({ error: "Card not found" }, { status: 404 });
      await runCharge({ invoiceId: inv.id, paymentMethodId: pm.id });
      return NextResponse.json({ ok: true });
    }
    await chargeInvoiceWithDefaultCard(inv.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Payment failed" }, { status: 402 });
  }
}
