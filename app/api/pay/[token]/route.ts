/**
 * Public hosted-invoice API (no auth — the unguessable payToken is the credential).
 *
 * GET  /api/pay/[token]                       → invoice summary for the pay page
 * POST /api/pay/[token] { sourceId, verificationToken?, saveCard? }
 *                                             → charge via Square, mark paid, email receipt
 * POST /api/pay/[token] { action: "apply-discount", code }
 *                                             → validate + apply a discount code to the open invoice
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getSquarePublicConfig, isSquareConfigured } from "@/lib/square";
import { chargeInvoiceWithSource, invoiceRemainingCents, PAID_STATUSES, vaultCard } from "@/services/billing.service";
import { applyDiscountCodeToInvoice } from "@/services/discount.service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

async function loadByToken(token: string) {
  if (!token || token.length < 8) return null;
  return getPrisma().invoice.findUnique({
    where: { payToken: token },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      member: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, zip: true } },
      location: { select: { id: true, name: true, businessName: true, slug: true, currency: true, logoUrl: true, phone: true, email: true } },
      subscription: { select: { plan: { select: { name: true } } } },
    },
  });
}

function summary(inv: NonNullable<Awaited<ReturnType<typeof loadByToken>>>, squareConfigured: boolean) {
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    description: inv.description,
    dueDate: inv.dueDate,
    paidAt: inv.paidAt,
    subtotalCents: inv.subtotalCents,
    discountCents: inv.discountCents,
    taxCents: inv.taxCents,
    surchargeCents: inv.surchargeCents,
    totalCents: inv.totalCents,
    refundedCents: inv.refundedCents,
    remainingCents: invoiceRemainingCents(inv),
    currency: inv.location.currency,
    lineItems: inv.lineItems.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, totalCents: l.totalCents })),
    member: { firstName: inv.member.firstName },
    location: { name: inv.location.businessName ?? inv.location.name, logoUrl: inv.location.logoUrl, phone: inv.location.phone, email: inv.location.email },
    planName: inv.subscription?.plan.name ?? null,
    payable: !(PAID_STATUSES as readonly string[]).includes(inv.status) && inv.status !== "CANCELLED" && invoiceRemainingCents(inv) > 0,
    squareConfigured: squareConfigured,
  };
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const inv = await loadByToken(token);
  if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  const square = await getSquarePublicConfig(inv.locationId);
  return NextResponse.json({ invoice: summary(inv, square.configured), square });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const inv = await loadByToken(token);
  if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const squareConfigured = await isSquareConfigured(inv.locationId);

  try {
    if (body.action === "apply-discount") {
      const r = await applyDiscountCodeToInvoice(inv.id, String(body.code ?? ""), null);
      const fresh = await loadByToken(token);
      return NextResponse.json({ ok: true, code: r.discount.code, amountCents: r.amountCents, invoice: fresh ? summary(fresh, squareConfigured) : null });
    }

    if (!squareConfigured) return NextResponse.json({ error: "Online payments are not available. Please contact the front desk." }, { status: 503 });
    const s = summary(inv, squareConfigured);
    if (!s.payable) return NextResponse.json({ error: "This invoice is no longer payable." }, { status: 409 });
    const sourceId = String(body.sourceId ?? "");
    if (!sourceId) return NextResponse.json({ error: "Missing card token" }, { status: 400 });

    const r = await chargeInvoiceWithSource({ invoiceId: inv.id, sourceId, verificationToken: body.verificationToken ?? null, buyerEmail: inv.member.email, note: `Invoice #${inv.number} (hosted pay page)` });
    if (!r.succeeded) return NextResponse.json({ error: "Payment was not approved." }, { status: 402 });

    // Optionally keep the card on file for future renewals. Needs a fresh nonce,
    // so we only do this when the client sent a second token.
    let savedCard: { brand: string | null; last4: string | null } | null = null;
    if (body.saveCard && body.saveCardSourceId) {
      try {
        const pm = await vaultCard({ memberId: inv.memberId, sourceId: String(body.saveCardSourceId), verificationToken: body.saveCardVerificationToken ?? null, source: "portal" });
        savedCard = { brand: pm.brand, last4: pm.last4 };
      } catch (e) {
        console.warn("[pay] save card failed", e);
      }
    }

    const fresh = await loadByToken(token);
    return NextResponse.json({ ok: true, invoice: fresh ? summary(fresh, squareConfigured) : null, receiptUrl: r.receiptUrl, savedCard });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Payment failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
