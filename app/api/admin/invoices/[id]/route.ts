/**
 * GET   /api/admin/invoices/[id]   → invoice detail incl. lines, charges, refunds, pay link (billing.view)
 * PATCH /api/admin/invoices/[id]   { description?, dueDate?, adminNotes? }                  (billing.edit-invoice)
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { ensurePayToken, publicPayUrl, updateInvoice } from "@/services/billing.service";
import { errorResponse, guardInvoice, parseDate } from "../../billing/_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardInvoice(id, "billing.view");
  if (!g.ok) return g.response;
  const token = await ensurePayToken(id);
  const invoice = await getPrisma().invoice.findUnique({
    where: { id },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      member: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true } },
      subscription: { include: { plan: { select: { id: true, name: true } } } },
      charges: { orderBy: { createdAt: "desc" }, include: { paymentMethod: true, refunds: true } },
      refunds: { orderBy: { createdAt: "desc" } },
    },
  });
  return NextResponse.json({ invoice, payUrl: publicPayUrl(token) });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardInvoice(id, "billing.edit-invoice");
  if (!g.ok) return g.response;
  const body = await req.json().catch(() => ({}));
  try {
    const dueDate = parseDate(body.dueDate);
    const invoice = await updateInvoice(
      id,
      {
        description: body.description === undefined ? undefined : body.description ? String(body.description) : null,
        dueDate: dueDate ?? undefined,
        scheduledFor: dueDate ?? undefined,
        adminNotes: body.adminNotes === undefined ? undefined : body.adminNotes ? String(body.adminNotes) : null,
      },
      g.actorId,
    );
    return NextResponse.json({ ok: true, invoice });
  } catch (e) {
    return errorResponse(e);
  }
}
