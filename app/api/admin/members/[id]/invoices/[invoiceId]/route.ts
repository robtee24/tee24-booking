import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { emitMemberEvent } from "@/lib/events";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";
import { apiError, readJson, requireMemberApi } from "../../../_shared";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/members/[id]/invoices/[invoiceId]
 *  { action: "mark-paid", method: "CASH" | "CHECK" | "OTHER", note? }   — permission billing.edit-invoice
 *  { action: "cancel", reason? }                                        — permission billing.write-off
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; invoiceId: string }> }) {
  const { id, invoiceId } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  const body = await readJson(req);
  const prisma = getPrisma();
  try {
    const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, memberId: id } });
    if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    if (body.action === "cancel") {
      assertCan(g.actor, "billing.write-off", { locationId: g.member.locationId });
      if (inv.status === "PAID") return NextResponse.json({ error: "Paid invoices cannot be cancelled — refund instead" }, { status: 400 });
      const updated = await prisma.invoice.update({ where: { id: invoiceId }, data: { status: "CANCELLED", adminNotes: appendNote(inv.adminNotes, `Cancelled by ${g.admin.name ?? "admin"}${body.reason ? `: ${body.reason}` : ""}`) } });
      void audit({ organizationId: inv.organizationId, actorId: g.admin.id, actorRole: g.admin.role, action: "billing.invoice-cancel", entityType: "Invoice", entityId: invoiceId, before: { status: inv.status }, after: { status: "CANCELLED" }, metadata: { reason: body.reason } });
      return NextResponse.json({ ok: true, invoice: updated });
    }

    // default: mark-paid
    assertCan(g.actor, "billing.edit-invoice", { locationId: g.member.locationId });
    if (inv.status === "PAID") return NextResponse.json({ error: "Invoice is already paid" }, { status: 400 });
    const method = ["CASH", "CHECK", "OTHER"].includes(String(body.method).toUpperCase()) ? String(body.method).toUpperCase() : "CASH";
    const amountCents = inv.totalCents - inv.refundedCents;
    const now = new Date();

    const [charge, updated] = await prisma.$transaction([
      prisma.charge.create({
        data: {
          organizationId: inv.organizationId,
          locationId: inv.locationId,
          memberId: id,
          invoiceId,
          subscriptionId: inv.subscriptionId,
          paymentMethodId: null,
          status: "SUCCEEDED",
          amountCents,
          idempotencyKey: `manual_${invoiceId}_${now.getTime()}`,
          attempt: inv.attemptCount + 1,
          failureReason: null,
        },
      }),
      prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: "PAID", paidAt: now, adminNotes: appendNote(inv.adminNotes, `Marked paid (${method.toLowerCase()}) by ${g.admin.name ?? "admin"}${body.note ? `: ${body.note}` : ""}`) },
      }),
    ]);

    void audit({ organizationId: inv.organizationId, actorId: g.admin.id, actorRole: g.admin.role, action: "billing.charge", entityType: "Charge", entityId: charge.id, after: { ...charge, manualMethod: method } });
    void emitMemberEvent("payment.succeeded", {
      memberId: id, locationId: g.member.locationId, organizationId: g.member.organizationId, actorAdminId: g.admin.id,
      refs: { invoiceId, chargeId: charge.id }, vars: { amountCents, method, invoiceNumber: inv.number },
    });
    const desired = await computeDesiredAccessState(id);
    void applyAccessState(id, desired);

    return NextResponse.json({ ok: true, invoice: updated, charge });
  } catch (e) {
    return apiError(e);
  }
}

function appendNote(existing: string | null, line: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  return [existing, `[${stamp}] ${line}`].filter(Boolean).join("\n");
}
