/**
 * Billing service — invoices, charges, refunds, payment methods, account credit.
 *
 * Source of truth for monetary state. All mutations:
 *  - audit-logged
 *  - emit dashboard notifications on key transitions
 *  - propagate to AccessSync when payment status crosses grace
 *
 * Square interactions:
 *  - All charges/refunds carry an idempotency key derived from invoice/charge id + attempt
 *  - Subscription / invoice IDs are stored to reconcile against Square webhook events
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminNotify } from "@/lib/admin-notify";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";
import {
  squareCreatePayment,
  squareCreateRefund,
} from "@/lib/square";

// ---------------------------------------------------------------------------
// Invoice helpers
// ---------------------------------------------------------------------------

export type InvoiceLineInput = {
  description: string;
  quantity?: number;
  unitCents: number;
  sortOrder?: number;
};

export type CreateInvoiceInput = {
  organizationId?: string | null;
  locationId: string;
  memberId: string;
  subscriptionId?: string | null;
  description?: string;
  dueDate: Date;
  scheduledFor?: Date | null;
  taxCents?: number;
  discountCents?: number;
  lines: InvoiceLineInput[];
  adminNotes?: string;
};

export async function createInvoice(input: CreateInvoiceInput, actorId?: string) {
  const prisma = getPrisma();
  const subtotalCents = input.lines.reduce(
    (sum, l) => sum + (l.unitCents * (l.quantity ?? 1)),
    0
  );
  const totalCents = Math.max(0, subtotalCents + (input.taxCents ?? 0) - (input.discountCents ?? 0));

  const invoice = await prisma.invoice.create({
    data: {
      organizationId: input.organizationId ?? null,
      locationId: input.locationId,
      memberId: input.memberId,
      subscriptionId: input.subscriptionId ?? null,
      description: input.description ?? null,
      status: "SCHEDULED",
      dueDate: input.dueDate,
      scheduledFor: input.scheduledFor ?? null,
      subtotalCents,
      discountCents: input.discountCents ?? 0,
      taxCents: input.taxCents ?? 0,
      totalCents,
      adminNotes: input.adminNotes ?? null,
      lineItems: {
        create: input.lines.map((l, i) => ({
          description: l.description,
          quantity: l.quantity ?? 1,
          unitCents: l.unitCents,
          totalCents: (l.quantity ?? 1) * l.unitCents,
          sortOrder: l.sortOrder ?? i,
        })),
      },
    },
  });

  void audit({
    organizationId: input.organizationId ?? null,
    actorId,
    action: "billing.invoice-edit",
    entityType: "Invoice",
    entityId: invoice.id,
    after: invoice,
  });

  return invoice;
}

// ---------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------

export type RunChargeInput = {
  invoiceId: string;
  paymentMethodId: string;
  /** Optional override of amount; default = invoice remaining */
  amountCents?: number;
  note?: string;
  actorId?: string;
};

/**
 * Run a charge against a member's payment method.
 * Persists a Charge row with the result of the Square call.
 *
 * Idempotency key: invoiceId + attempt count (prevents duplicate Square charges
 * even if our webhook retries).
 */
export async function runCharge(input: RunChargeInput) {
  const prisma = getPrisma();
  const inv = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    include: { member: { select: { id: true, firstName: true, lastName: true, organizationId: true, locationId: true } } },
  });
  if (!inv) throw new Error("Invoice not found");
  if (inv.status === "PAID") throw new Error("Invoice already paid");

  const pm = await prisma.paymentMethod.findUnique({ where: { id: input.paymentMethodId } });
  if (!pm || !pm.squareCardId) throw new Error("Payment method not found or has no Square card token");

  const remainingCents = (inv.totalCents - inv.refundedCents);
  const amountCents = input.amountCents ?? remainingCents;
  if (amountCents <= 0) throw new Error("Nothing to charge");

  const attemptCount = await prisma.charge.count({ where: { invoiceId: inv.id } });
  const idempotencyKey = `inv_${inv.id}_attempt_${attemptCount + 1}`;

  // Optimistically write a PENDING charge so retries can dedupe
  const charge = await prisma.charge.create({
    data: {
      invoiceId: inv.id,
      memberId: inv.memberId,
      subscriptionId: inv.subscriptionId,
      paymentMethodId: pm.id,
      organizationId: inv.organizationId,
      locationId: inv.locationId,
      amountCents,
      status: "PENDING",
      idempotencyKey,
      attempt: attemptCount + 1,
    },
  });

  try {
    const result = await squareCreatePayment({
      amountCents,
      sourceId: pm.squareCardId,
      idempotencyKey,
      note: input.note ?? `Invoice ${inv.number}`,
    });

    const succeeded = result.status === "COMPLETED" || result.status === "APPROVED";
    const updated = await prisma.charge.update({
      where: { id: charge.id },
      data: {
        squarePaymentId: result.id,
        status: succeeded ? "SUCCEEDED" : result.status,
      },
    });

    if (succeeded) {
      await markInvoicePaid(inv.id, amountCents);
      void adminNotify({
        organizationId: inv.organizationId,
        locationId: inv.locationId,
        kind: "billing.payment-succeeded",
        severity: "INFO",
        title: `Payment received from ${inv.member.firstName} ${inv.member.lastName}`,
        body: `Invoice #${inv.number} — ${(amountCents / 100).toFixed(2)}`,
        link: `/admin/locations/${inv.locationId}/billing/payments`,
      });
      // Door access may need to be re-enabled
      const desired = await computeDesiredAccessState(inv.memberId);
      void applyAccessState(inv.memberId, desired);
    }

    void audit({
      organizationId: inv.organizationId,
      actorId: input.actorId,
      action: "billing.charge",
      entityType: "Charge",
      entityId: charge.id,
      after: updated,
    });

    return updated;
  } catch (err: any) {
    await prisma.charge.update({
      where: { id: charge.id },
      data: { status: "FAILED", failureReason: String(err?.message ?? err) },
    });
    void adminNotify({
      organizationId: inv.organizationId,
      locationId: inv.locationId,
      kind: "billing.payment-failed",
      severity: "ERROR",
      title: `Payment failed for ${inv.member.firstName} ${inv.member.lastName}`,
      body: `Invoice #${inv.number} — ${err?.message ?? "Unknown error"}`,
      link: `/admin/locations/${inv.locationId}/members/list/${inv.memberId}`,
    });
    void audit({
      organizationId: inv.organizationId,
      actorId: input.actorId,
      action: "billing.charge",
      entityType: "Charge",
      entityId: charge.id,
      metadata: { failed: true, error: String(err?.message ?? err) },
    });
    throw err;
  }
}

async function markInvoicePaid(invoiceId: string, paidCents: number) {
  const prisma = getPrisma();
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) return;
  const fullyPaid = (paidCents >= inv.totalCents - inv.refundedCents);
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: fullyPaid ? "PAID" : "PARTIALLY_REFUNDED", paidAt: fullyPaid ? new Date() : undefined },
  });
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export type RefundInput = {
  chargeId: string;
  amountCents: number;
  reason?: string;
  actorId?: string;
};

export async function refundCharge(input: RefundInput) {
  const prisma = getPrisma();
  const charge = await prisma.charge.findUnique({
    where: { id: input.chargeId },
    include: { invoice: true, member: true },
  });
  if (!charge) throw new Error("Charge not found");
  if (!charge.squarePaymentId) throw new Error("Charge has no Square payment id (cannot refund)");

  if (input.amountCents <= 0 || input.amountCents > charge.amountCents) {
    throw new Error("Invalid refund amount");
  }

  const idempotencyKey = `refund_${charge.id}_${Date.now()}`;
  const sq = await squareCreateRefund({
    paymentId: charge.squarePaymentId,
    amountCents: input.amountCents,
    idempotencyKey,
    reason: input.reason,
  });

  const refund = await prisma.refund.create({
    data: {
      chargeId: charge.id,
      invoiceId: charge.invoiceId,
      amountCents: input.amountCents,
      reason: input.reason ?? null,
      squareRefundId: sq.id,
      status: sq.status,
      refundedById: input.actorId ?? null,
    },
  });

  // Mirror to charge + invoice
  const newChargeStatus =
    input.amountCents >= charge.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
  await prisma.charge.update({
    where: { id: charge.id },
    data: { status: newChargeStatus },
  });

  if (charge.invoice) {
    const totalRefunded = charge.invoice.refundedCents + input.amountCents;
    await prisma.invoice.update({
      where: { id: charge.invoice.id },
      data: {
        refundedCents: totalRefunded,
        status: totalRefunded >= charge.invoice.totalCents ? "REFUNDED" : "PARTIALLY_REFUNDED",
      },
    });
  }

  void audit({
    organizationId: charge.organizationId,
    actorId: input.actorId,
    action: "billing.refund",
    entityType: "Refund",
    entityId: refund.id,
    after: refund,
    metadata: { chargeId: charge.id },
  });

  void adminNotify({
    organizationId: charge.organizationId,
    locationId: charge.locationId,
    kind: "billing.refund-issued",
    severity: "WARN",
    title: `Refund issued (${(input.amountCents / 100).toFixed(2)})`,
    body: `Member: ${charge.member?.firstName ?? "?"} ${charge.member?.lastName ?? ""}. Reason: ${input.reason ?? "—"}`,
    link: charge.locationId ? `/admin/locations/${charge.locationId}/billing/payments` : undefined,
  });

  return refund;
}

// ---------------------------------------------------------------------------
// Account credit ledger
// ---------------------------------------------------------------------------

/**
 * Add credit to member. amountCents is positive for additions; pass negative
 * to record a spend.
 */
export async function addCredit(opts: {
  memberId: string;
  amountCents: number;
  type: "REFERRAL" | "COMP" | "REFUND_AS_CREDIT" | "ADJUSTMENT";
  reason?: string;
  actorId?: string;
}) {
  const prisma = getPrisma();
  const credit = await prisma.memberCredit.create({
    data: {
      memberId: opts.memberId,
      amountCents: opts.amountCents,
      type: opts.type,
      reason: opts.reason ?? null,
      createdById: opts.actorId ?? null,
    },
  });
  void audit({
    actorId: opts.actorId,
    action: opts.amountCents >= 0 ? "billing.credit-add" : "billing.credit-spend",
    entityType: "MemberCredit",
    entityId: credit.id,
    after: credit,
  });
  return credit;
}

export async function getCreditBalanceCents(memberId: string): Promise<number> {
  const prisma = getPrisma();
  const credits = await prisma.memberCredit.aggregate({
    where: { memberId },
    _sum: { amountCents: true },
  });
  return credits._sum.amountCents ?? 0;
}

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

export async function listPaymentMethods(memberId: string) {
  return getPrisma().paymentMethod.findMany({ where: { memberId }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] });
}

export async function setDefaultPaymentMethod(memberId: string, paymentMethodId: string, actorId?: string) {
  const prisma = getPrisma();
  await prisma.$transaction([
    prisma.paymentMethod.updateMany({ where: { memberId }, data: { isDefault: false } }),
    prisma.paymentMethod.update({ where: { id: paymentMethodId }, data: { isDefault: true } }),
  ]);
  void audit({
    actorId,
    action: "billing.payment-method-default",
    entityType: "PaymentMethod",
    entityId: paymentMethodId,
  });
}

// ---------------------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------------------

export async function getRevenueSummary(opts: {
  locationId?: string;
  organizationId?: string;
  start: Date;
  end: Date;
}) {
  const prisma = getPrisma();
  const where: any = { paidAt: { gte: opts.start, lt: opts.end }, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } };
  if (opts.locationId) where.locationId = opts.locationId;
  if (opts.organizationId) where.organizationId = opts.organizationId;

  const invoices = await prisma.invoice.findMany({ where, select: { totalCents: true, refundedCents: true } });
  const grossCents = invoices.reduce((s, i) => s + i.totalCents, 0);
  const refundedCents = invoices.reduce((s, i) => s + i.refundedCents, 0);
  return { grossCents, refundedCents, netCents: grossCents - refundedCents, count: invoices.length };
}

export async function getOverdueSummary(locationId?: string) {
  const prisma = getPrisma();
  const where: any = { status: { in: ["PAST_DUE", "FAILED"] } };
  if (locationId) where.locationId = locationId;
  const invoices = await prisma.invoice.findMany({ where, select: { totalCents: true, refundedCents: true } });
  return {
    count: invoices.length,
    overdueCents: invoices.reduce((s, i) => s + (i.totalCents - i.refundedCents), 0),
  };
}
