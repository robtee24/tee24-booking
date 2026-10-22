/**
 * GET  /api/admin/invoices?locationSlug=&tab=&q=&number=&txn=&last4=&memberId=&memberStatus=&scheduledFrom=&scheduledTo=&paidFrom=&paidTo=[&format=csv]
 *        → filtered invoice list (billing.view). `format=csv` streams a CSV export.
 * POST /api/admin/invoices { locationSlug, memberId, description, dueDate, lines:[{description, unitCents, quantity}], applyTax?, discountCode? }
 *        → create a one-off invoice (billing.edit-invoice)
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { countInvoicesByTab, createInvoice, invoicesToCsv, queryInvoices, sendPayLinkEmail, type InvoiceTab } from "@/services/billing.service";
import { applyDiscountCodeToInvoice } from "@/services/discount.service";
import { csvResponse, errorResponse, guardBilling, parseDate } from "../billing/_shared";

export const dynamic = "force-dynamic";

const TABS: InvoiceTab[] = ["PAID", "SCHEDULED", "OVERDUE", "REFUNDED", "CANCELLED", "ALL"];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const g = await guardBilling({ locationSlug: sp.get("locationSlug"), locationId: sp.get("locationId") }, "billing.view");
  if (!g.ok) return g.response;
  const tabRaw = (sp.get("tab") ?? "ALL").toUpperCase() as InvoiceTab;
  const tab = TABS.includes(tabRaw) ? tabRaw : "ALL";
  const filter = {
    locationId: g.location.id,
    tab,
    q: sp.get("q"),
    number: sp.get("number"),
    txn: sp.get("txn"),
    last4: sp.get("last4"),
    memberId: sp.get("memberId"),
    memberStatus: sp.get("memberStatus"),
    scheduledFrom: parseDate(sp.get("scheduledFrom")),
    scheduledTo: parseDate(sp.get("scheduledTo")),
    paidFrom: parseDate(sp.get("paidFrom")),
    paidTo: parseDate(sp.get("paidTo")),
    take: sp.get("format") === "csv" ? 5000 : Math.min(500, Number(sp.get("take") ?? 200) || 200),
  };
  try {
    const rows = await queryInvoices(filter);
    if (sp.get("format") === "csv") {
      return csvResponse(invoicesToCsv(rows), `payments-${g.location.slug}-${tab.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`);
    }
    const counts = await countInvoicesByTab(g.location.id);
    return NextResponse.json({ invoices: rows, counts });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const g = await guardBilling({ locationSlug: body.locationSlug, locationId: body.locationId }, "billing.edit-invoice");
  if (!g.ok) return g.response;
  try {
    const prisma = getPrisma();
    const member = await prisma.member.findUnique({ where: { id: String(body.memberId ?? "") }, select: { id: true, organizationId: true, locationId: true } });
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    const location = await prisma.location.findUnique({ where: { id: g.location.id } });
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const cleanLines = lines
      .map((l: { description?: string; unitCents?: number; quantity?: number }) => ({
        description: String(l.description ?? "").trim(),
        unitCents: Math.round(Number(l.unitCents)),
        quantity: Math.max(1, Math.floor(Number(l.quantity ?? 1)) || 1),
      }))
      .filter((l: { description: string; unitCents: number }) => l.description && Number.isFinite(l.unitCents) && l.unitCents > 0);
    if (cleanLines.length === 0) return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });

    const invoice = await createInvoice(
      {
        organizationId: member.organizationId,
        locationId: g.location.id,
        memberId: member.id,
        description: body.description ? String(body.description) : undefined,
        dueDate: parseDate(body.dueDate) ?? new Date(),
        scheduledFor: parseDate(body.dueDate),
        taxRateBps: body.applyTax === false ? 0 : location?.taxRateBps ?? 0,
        lines: cleanLines,
        adminNotes: body.adminNotes ? String(body.adminNotes) : undefined,
      },
      g.actorId,
    );
    let discount: { code: string; amountCents: number } | null = null;
    if (body.discountCode) {
      const r = await applyDiscountCodeToInvoice(invoice.id, String(body.discountCode), g.actorId);
      discount = { code: r.discount.code, amountCents: r.amountCents };
    }
    if (body.sendPayLink) await sendPayLinkEmail(invoice.id).catch(() => null);
    const fresh = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    return NextResponse.json({ ok: true, invoice: fresh, discount });
  } catch (e) {
    return errorResponse(e);
  }
}
