import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { emitMemberEvent } from "@/lib/events";
import { createInvoice, runCharge, listPaymentMethods, getCreditBalanceCents } from "@/services/billing.service";
import { apiError, readJson, requireMemberApi, toCents } from "../../_shared";

export const dynamic = "force-dynamic";

/** GET /api/admin/members/[id]/invoices?status= — invoices (with lines + charges), credit balance, payment methods */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "billing.view", { locationId: g.member.locationId });
    const status = req.nextUrl.searchParams.get("status");
    const where: Prisma.InvoiceWhereInput = { memberId: id };
    if (status && status !== "ALL") {
      if (status === "OPEN") where.status = { in: ["SCHEDULED", "PAST_DUE", "FAILED"] };
      else where.status = status;
    }
    const prisma = getPrisma();
    const [invoices, creditBalanceCents, credits, paymentMethods, summary] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
        take: 200,
        include: {
          lineItems: { orderBy: { sortOrder: "asc" } },
          charges: { orderBy: { createdAt: "desc" }, include: { refunds: true } },
          subscription: { select: { id: true, plan: { select: { name: true } } } },
        },
      }),
      getCreditBalanceCents(id),
      prisma.memberCredit.findMany({ where: { memberId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
      listPaymentMethods(id),
      prisma.invoice.groupBy({ by: ["status"], where: { memberId: id }, _sum: { totalCents: true, refundedCents: true }, _count: { _all: true } }),
    ]);
    const outstanding = summary
      .filter((s) => ["SCHEDULED", "PAST_DUE", "FAILED"].includes(s.status))
      .reduce((acc, s) => acc + (s._sum.totalCents ?? 0) - (s._sum.refundedCents ?? 0), 0);
    const overdue = summary
      .filter((s) => ["PAST_DUE", "FAILED"].includes(s.status))
      .reduce((acc, s) => acc + (s._sum.totalCents ?? 0) - (s._sum.refundedCents ?? 0), 0);
    return NextResponse.json({
      invoices,
      creditBalanceCents,
      credits,
      paymentMethods,
      summary: { outstandingCents: outstanding, overdueCents: overdue, counts: Object.fromEntries(summary.map((s) => [s.status, s._count._all])) },
      taxRateBps: g.location.taxRateBps,
    });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST /api/admin/members/[id]/invoices — create a one-time charge.
 * { description, amount | amountCents, quantity?, taxable?, discountAmount?, discountPercent?, dueDate?, chargeNow?, paymentMethodId?, adminNotes? }
 * Permission billing.charge.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "billing.charge", { locationId: g.member.locationId });
    const body = await readJson(req);
    const description = String(body.description ?? "").trim();
    if (!description) return NextResponse.json({ error: "Description is required" }, { status: 400 });
    const unitCents = body.amountCents != null ? Math.round(Number(body.amountCents)) : toCents(body.amount);
    if (!Number.isFinite(unitCents) || unitCents <= 0) return NextResponse.json({ error: "Amount must be greater than zero" }, { status: 400 });
    const quantity = Math.max(1, Math.round(Number(body.quantity ?? 1)) || 1);
    const subtotal = unitCents * quantity;

    let discountCents = 0;
    if (body.discountPercent != null && body.discountPercent !== "") discountCents = Math.round((subtotal * Number(body.discountPercent)) / 100);
    else if (body.discountAmount != null && body.discountAmount !== "") discountCents = body.discountAmountCents != null ? Math.round(Number(body.discountAmountCents)) : toCents(body.discountAmount);
    discountCents = Math.min(Math.max(0, discountCents), subtotal);

    const taxCents = body.taxable ? Math.round(((subtotal - discountCents) * g.location.taxRateBps) / 10_000) : 0;
    const dueDate = body.dueDate ? new Date(body.dueDate) : new Date();

    const invoice = await createInvoice(
      {
        organizationId: g.member.organizationId,
        locationId: g.member.locationId,
        memberId: id,
        description,
        dueDate: Number.isNaN(dueDate.getTime()) ? new Date() : dueDate,
        taxCents,
        discountCents,
        lines: [{ description, quantity, unitCents }],
        adminNotes: body.adminNotes ? String(body.adminNotes) : undefined,
      },
      g.admin.id,
    );

    let charge: Awaited<ReturnType<typeof runCharge>> | null = null;
    let chargeError: string | null = null;
    if (body.chargeNow) {
      const methods = await listPaymentMethods(id);
      const pm = body.paymentMethodId ? methods.find((m) => m.id === body.paymentMethodId) : methods.find((m) => m.isDefault && m.status === "ACTIVE") ?? methods.find((m) => m.status === "ACTIVE");
      if (!pm) {
        chargeError = "No card on file — invoice created but not charged.";
      } else {
        try {
          charge = await runCharge({ invoiceId: invoice.id, paymentMethodId: pm.id, note: description, actorId: g.admin.id });
          if (charge.status === "SUCCEEDED") {
            void emitMemberEvent("payment.succeeded", {
              memberId: id, locationId: g.member.locationId, organizationId: g.member.organizationId, actorAdminId: g.admin.id,
              refs: { invoiceId: invoice.id, chargeId: charge.id }, vars: { amountCents: charge.amountCents, description },
            });
          }
        } catch (e) {
          chargeError = e instanceof Error ? e.message : "Charge failed";
          void emitMemberEvent("payment.failed", {
            memberId: id, locationId: g.member.locationId, organizationId: g.member.organizationId, actorAdminId: g.admin.id,
            refs: { invoiceId: invoice.id }, vars: { amountCents: invoice.totalCents, description, error: chargeError },
          });
        }
      }
    }

    const fresh = await getPrisma().invoice.findUnique({ where: { id: invoice.id }, include: { lineItems: true, charges: true } });
    return NextResponse.json({ ok: true, invoice: fresh, charge, chargeError });
  } catch (e) {
    return apiError(e);
  }
}
