/**
 * Billing service — invoices, charges, refunds, payment methods, account credit.
 *
 * Source of truth for monetary state. All mutations:
 *  - audit-logged
 *  - emit dashboard notifications + member events on key transitions
 *  - propagate to AccessSync when payment status crosses grace
 *
 * Square interactions:
 *  - Every call is gated on `isSquareConfigured()`; when Square is not set up
 *    only manual (cash/other) collection is possible.
 *  - All charges/refunds carry an idempotency key derived from invoice/charge id + attempt
 *  - Payment / refund IDs are stored to reconcile against Square webhook events
 *
 * Money model (all integer cents):
 *   subtotal  = Σ line totals
 *   discount  = DiscountApplication(s) on the invoice
 *   tax       = round((subtotal - discount) * Location.taxRateBps / 10_000)
 *   surcharge = round((subtotal - discount + tax) * Location.cardSurchargeBps / 10_000)   (card payments only)
 *   total     = subtotal - discount + tax + surcharge
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminNotify } from "@/lib/admin-notify";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";
import { emitMemberEvent } from "@/lib/events";
import { sendEmail } from "@/lib/notify";
import { ENV } from "@/lib/env";
import { adminRoutes } from "@/lib/admin/routes";
import {
  isSquareConfigured,
  squareCreateCardOnFile,
  squareCreateCustomer,
  squareCreatePayment,
  squareCreateRefund,
  squareDisableCard,
  squareFailureReason,
} from "@/lib/square";
import type { Invoice, Location, Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------

export const PAID_STATUSES = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
export const OVERDUE_STATUSES = ["PAST_DUE", "FAILED"] as const;
export const OPEN_STATUSES = ["SCHEDULED", "PAST_DUE", "FAILED"] as const;

export function bpsOf(cents: number, bps: number): number {
  if (!bps || bps <= 0 || cents <= 0) return 0;
  return Math.round((cents * bps) / 10_000);
}

export type InvoiceMath = {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  surchargeCents: number;
  totalCents: number;
};

/** Pure money math used by invoice creation and by the UI previews. */
export function computeInvoiceMath(opts: {
  subtotalCents: number;
  discountCents?: number;
  taxRateBps?: number;
  surchargeBps?: number;
  /** Apply the card surcharge (only when the payer uses a card). */
  applySurcharge?: boolean;
}): InvoiceMath {
  const subtotalCents = Math.max(0, Math.round(opts.subtotalCents));
  const discountCents = Math.min(subtotalCents, Math.max(0, Math.round(opts.discountCents ?? 0)));
  const taxable = subtotalCents - discountCents;
  const taxCents = bpsOf(taxable, opts.taxRateBps ?? 0);
  const surchargeCents = opts.applySurcharge ? bpsOf(taxable + taxCents, opts.surchargeBps ?? 0) : 0;
  return { subtotalCents, discountCents, taxCents, surchargeCents, totalCents: taxable + taxCents + surchargeCents };
}

export function invoiceRemainingCents(inv: Pick<Invoice, "totalCents" | "refundedCents">): number {
  return Math.max(0, inv.totalCents - inv.refundedCents);
}

export function publicPayUrl(payToken: string): string {
  return `${ENV.APP_BASE_URL.replace(/\/$/, "")}/pay/${encodeURIComponent(payToken)}`;
}

/** Existing rows pre-date the `payToken` column; mint one lazily. */
export async function ensurePayToken(invoiceId: string): Promise<string> {
  const prisma = getPrisma();
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { payToken: true } });
  if (!inv) throw new Error("Invoice not found");
  if (inv.payToken) return inv.payToken;
  const token = `pay_${crypto.randomUUID().replace(/-/g, "")}`;
  await prisma.invoice.update({ where: { id: invoiceId }, data: { payToken: token } });
  return token;
}

// ---------------------------------------------------------------------------
// Invoice creation
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
  /** Explicit tax override; otherwise computed from `taxRateBps`. */
  taxCents?: number;
  taxRateBps?: number;
  discountCents?: number;
  /** Explicit surcharge override; otherwise computed from `surchargeBps` when `applySurcharge`. */
  surchargeCents?: number;
  surchargeBps?: number;
  applySurcharge?: boolean;
  lines: InvoiceLineInput[];
  adminNotes?: string;
  status?: "SCHEDULED" | "PAST_DUE";
};

export async function createInvoice(input: CreateInvoiceInput, actorId?: string) {
  const prisma = getPrisma();
  const subtotalCents = input.lines.reduce((sum, l) => sum + l.unitCents * (l.quantity ?? 1), 0);
  const math = computeInvoiceMath({
    subtotalCents,
    discountCents: input.discountCents,
    taxRateBps: input.taxRateBps,
    surchargeBps: input.surchargeBps,
    applySurcharge: input.applySurcharge,
  });
  const taxCents = input.taxCents ?? math.taxCents;
  const surchargeCents = input.surchargeCents ?? math.surchargeCents;
  const totalCents = Math.max(0, math.subtotalCents - math.discountCents + taxCents + surchargeCents);

  const invoice = await prisma.invoice.create({
    data: {
      organizationId: input.organizationId ?? null,
      locationId: input.locationId,
      memberId: input.memberId,
      subscriptionId: input.subscriptionId ?? null,
      description: input.description ?? null,
      status: input.status ?? "SCHEDULED",
      dueDate: input.dueDate,
      scheduledFor: input.scheduledFor ?? null,
      subtotalCents: math.subtotalCents,
      discountCents: math.discountCents,
      taxCents,
      surchargeCents,
      totalCents,
      adminNotes: input.adminNotes ?? null,
      payToken: `pay_${crypto.randomUUID().replace(/-/g, "")}`,
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
    metadata: { created: true },
  });

  return invoice;
}

/** Recompute tax/surcharge/total after lines or discount changed. */
export async function recomputeInvoiceTotals(invoiceId: string, opts?: { applySurcharge?: boolean }) {
  const prisma = getPrisma();
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { lineItems: true, location: { select: { taxRateBps: true, cardSurchargeBps: true } } },
  });
  if (!inv) throw new Error("Invoice not found");
  const subtotalCents = inv.lineItems.reduce((s, l) => s + l.totalCents, 0);
  const applySurcharge = opts?.applySurcharge ?? inv.surchargeCents > 0;
  const math = computeInvoiceMath({
    subtotalCents,
    discountCents: inv.discountCents,
    taxRateBps: inv.location.taxRateBps,
    surchargeBps: inv.location.cardSurchargeBps,
    applySurcharge,
  });
  return prisma.invoice.update({ where: { id: invoiceId }, data: math });
}

export type UpdateInvoiceInput = {
  description?: string | null;
  dueDate?: Date;
  scheduledFor?: Date | null;
  adminNotes?: string | null;
};

export async function updateInvoice(invoiceId: string, patch: UpdateInvoiceInput, actorId?: string) {
  const prisma = getPrisma();
  const before = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!before) throw new Error("Invoice not found");
  if ((PAID_STATUSES as readonly string[]).includes(before.status) && patch.dueDate) {
    throw new Error("Paid invoices cannot be rescheduled");
  }
  const after = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      description: patch.description === undefined ? undefined : patch.description,
      dueDate: patch.dueDate,
      scheduledFor: patch.scheduledFor === undefined ? undefined : patch.scheduledFor,
      adminNotes: patch.adminNotes === undefined ? undefined : patch.adminNotes,
    },
  });
  void audit({
    organizationId: before.organizationId,
    actorId,
    action: "billing.invoice-edit",
    entityType: "Invoice",
    entityId: invoiceId,
    before: { description: before.description, dueDate: before.dueDate, adminNotes: before.adminNotes },
    after: { description: after.description, dueDate: after.dueDate, adminNotes: after.adminNotes },
  });
  return after;
}

export async function addInvoiceLine(invoiceId: string, line: InvoiceLineInput, actorId?: string) {
  const prisma = getPrisma();
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { lineItems: true } });
  if (!inv) throw new Error("Invoice not found");
  if (!(OPEN_STATUSES as readonly string[]).includes(inv.status)) throw new Error("Only open invoices can be edited");
  await prisma.invoiceLineItem.create({
    data: {
      invoiceId,
      description: line.description,
      quantity: line.quantity ?? 1,
      unitCents: line.unitCents,
      totalCents: (line.quantity ?? 1) * line.unitCents,
      sortOrder: line.sortOrder ?? inv.lineItems.length,
    },
  });
  const updated = await recomputeInvoiceTotals(invoiceId);
  void audit({
    organizationId: inv.organizationId,
    actorId,
    action: "billing.invoice-edit",
    entityType: "Invoice",
    entityId: invoiceId,
    metadata: { addedLine: line },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Paid / failed transitions (shared by card charges, manual payments, webhooks)
// ---------------------------------------------------------------------------

type InvoiceWithMember = Prisma.InvoiceGetPayload<{
  include: { member: { select: { id: true; firstName: true; lastName: true; email: true; organizationId: true; locationId: true } } };
}>;

async function loadInvoiceWithMember(invoiceId: string): Promise<InvoiceWithMember> {
  const inv = await getPrisma().invoice.findUnique({
    where: { id: invoiceId },
    include: { member: { select: { id: true, firstName: true, lastName: true, email: true, organizationId: true, locationId: true } } },
  });
  if (!inv) throw new Error("Invoice not found");
  return inv;
}

/**
 * Mark an invoice paid and run all side effects:
 *  - subscription activation (PENDING → ACTIVE) or renewal bookkeeping
 *  - access-state recompute
 *  - member events (payment.succeeded, membership.activated / membership.renewed)
 *  - admin inbox notification
 */
export async function onInvoicePaid(
  invoiceId: string,
  opts: { paidCents: number; method: string; chargeId?: string | null; actorId?: string | null; receipt?: boolean },
) {
  const prisma = getPrisma();
  const inv = await loadInvoiceWithMember(invoiceId);
  if ((PAID_STATUSES as readonly string[]).includes(inv.status)) return inv;

  const fullyPaid = opts.paidCents >= invoiceRemainingCents(inv);
  const paidAt = new Date();
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: fullyPaid ? "PAID" : "PARTIALLY_REFUNDED",
      paidAt: fullyPaid ? paidAt : undefined,
      nextRetryAt: null,
      lastFailureReason: null,
    },
  });

  let activated = false;
  let renewed = false;
  let planName: string | null = null;
  if (inv.subscriptionId && fullyPaid) {
    const sub = await prisma.membershipSubscription.findUnique({ where: { id: inv.subscriptionId }, include: { plan: { select: { name: true } } } });
    if (sub) {
      planName = sub.plan.name;
      const { advanceByCadence } = await import("./recurring-billing.service");
      const periodStart = inv.scheduledFor ?? inv.dueDate ?? paidAt;
      const paidThrough = advanceByCadence(periodStart, sub.billingCadence);
      const data: Prisma.MembershipSubscriptionUpdateInput = {};
      if (sub.status === "PENDING") {
        data.status = "ACTIVE";
        activated = true;
      } else {
        renewed = true;
      }
      if (!sub.paidThroughDate || sub.paidThroughDate < paidThrough) data.paidThroughDate = paidThrough;
      if (!sub.nextInvoiceDate || sub.nextInvoiceDate <= periodStart) data.nextInvoiceDate = paidThrough;
      await prisma.membershipSubscription.update({ where: { id: sub.id }, data });
    }
  }

  if (activated) {
    await prisma.member.updateMany({ where: { id: inv.memberId, status: "PENDING" }, data: { status: "ACTIVE" } });
  }

  const desired = await computeDesiredAccessState(inv.memberId);
  void applyAccessState(inv.memberId, desired);

  void adminNotify({
    organizationId: inv.organizationId,
    locationId: inv.locationId,
    kind: "billing.payment-succeeded",
    severity: "INFO",
    title: `Payment received from ${inv.member.firstName} ${inv.member.lastName}`,
    body: `Invoice #${inv.number} — $${(opts.paidCents / 100).toFixed(2)} (${opts.method.toLowerCase()})`,
    link: adminRoutes.loc.billing.payments(await locationSlug(inv.locationId)),
    data: { invoiceId: inv.id },
  });

  const vars = {
    amount: (opts.paidCents / 100).toFixed(2),
    invoiceNumber: inv.number,
    method: opts.method,
    planName,
    firstName: inv.member.firstName,
  };
  await emitMemberEvent("payment.succeeded", {
    memberId: inv.memberId,
    locationId: inv.locationId,
    organizationId: inv.organizationId,
    refs: { invoiceId: inv.id, subscriptionId: inv.subscriptionId ?? undefined, chargeId: opts.chargeId ?? undefined },
    actorAdminId: opts.actorId ?? null,
    vars,
  });
  if (activated) {
    await emitMemberEvent("membership.activated", {
      memberId: inv.memberId,
      locationId: inv.locationId,
      organizationId: inv.organizationId,
      refs: { invoiceId: inv.id, subscriptionId: inv.subscriptionId ?? undefined },
      vars,
    });
  } else if (renewed) {
    await emitMemberEvent("membership.renewed", {
      memberId: inv.memberId,
      locationId: inv.locationId,
      organizationId: inv.organizationId,
      refs: { invoiceId: inv.id, subscriptionId: inv.subscriptionId ?? undefined },
      vars,
    });
  }

  if (opts.receipt !== false) void sendReceiptEmail(inv.id).catch(() => {});
  return loadInvoiceWithMember(invoiceId);
}

const slugCache = new Map<string, string>();
async function locationSlug(locationId: string): Promise<string> {
  const cached = slugCache.get(locationId);
  if (cached) return cached;
  const loc = await getPrisma().location.findUnique({ where: { id: locationId }, select: { slug: true } });
  const slug = loc?.slug ?? locationId;
  slugCache.set(locationId, slug);
  return slug;
}

/** Record a failed attempt and schedule the next dunning retry. */
export async function onInvoiceChargeFailed(
  invoiceId: string,
  opts: { reason: string; chargeId?: string | null; actorId?: string | null },
) {
  const prisma = getPrisma();
  const inv = await loadInvoiceWithMember(invoiceId);
  const location = await prisma.location.findUnique({ where: { id: inv.locationId } });
  const { nextRetryAtFor } = await import("./dunning.service");
  const attemptCount = inv.attemptCount + 1;
  const nextRetryAt = location ? nextRetryAtFor(location, attemptCount) : null;

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: "PAST_DUE",
      attemptCount,
      lastFailureReason: opts.reason.slice(0, 500),
      nextRetryAt,
    },
  });

  void adminNotify({
    organizationId: inv.organizationId,
    locationId: inv.locationId,
    kind: "billing.payment-failed",
    severity: "ERROR",
    title: `Payment failed for ${inv.member.firstName} ${inv.member.lastName}`,
    body: `Invoice #${inv.number} — ${opts.reason}`,
    link: adminRoutes.loc.billing.invoiceDetail(await locationSlug(inv.locationId), inv.id),
    data: { invoiceId: inv.id, attemptCount },
  });

  const desired = await computeDesiredAccessState(inv.memberId);
  void applyAccessState(inv.memberId, desired);

  await emitMemberEvent("payment.failed", {
    memberId: inv.memberId,
    locationId: inv.locationId,
    organizationId: inv.organizationId,
    refs: { invoiceId: inv.id, subscriptionId: inv.subscriptionId ?? undefined, chargeId: opts.chargeId ?? undefined },
    actorAdminId: opts.actorId ?? null,
    vars: {
      amount: (invoiceRemainingCents(inv) / 100).toFixed(2),
      invoiceNumber: inv.number,
      reason: opts.reason,
      attempt: attemptCount,
      nextRetryAt: nextRetryAt?.toISOString() ?? null,
      payUrl: inv.payToken ? publicPayUrl(inv.payToken) : null,
      firstName: inv.member.firstName,
    },
  });
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
 * Run a charge against a member's card on file.
 * Persists a Charge row with the result of the Square call.
 *
 * Idempotency key: invoiceId + attempt count (prevents duplicate Square charges
 * even if our webhook retries).
 */
export async function runCharge(input: RunChargeInput) {
  if (!isSquareConfigured()) throw new Error("Square is not configured — collect this payment manually (cash/other).");
  const prisma = getPrisma();
  const inv = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    include: { member: { select: { id: true, firstName: true, lastName: true, email: true, organizationId: true, locationId: true, squareCustomerId: true } } },
  });
  if (!inv) throw new Error("Invoice not found");
  if ((PAID_STATUSES as readonly string[]).includes(inv.status)) throw new Error("Invoice already paid");
  if (inv.status === "CANCELLED") throw new Error("Invoice was written off");

  const pm = await prisma.paymentMethod.findUnique({ where: { id: input.paymentMethodId } });
  if (!pm || !pm.squareCardId) throw new Error("Payment method not found or has no Square card token");
  if (pm.memberId !== inv.memberId) throw new Error("Payment method belongs to a different member");
  if (pm.status === "EXPIRED") throw new Error("Card on file has expired");

  const amountCents = input.amountCents ?? invoiceRemainingCents(inv);
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
      customerId: inv.member.squareCustomerId ?? undefined,
      idempotencyKey,
      note: input.note ?? `Invoice #${inv.number}`,
      referenceId: inv.id,
    });

    const succeeded = result.status === "COMPLETED" || result.status === "APPROVED";
    const updated = await prisma.charge.update({
      where: { id: charge.id },
      data: {
        squarePaymentId: result.id,
        status: succeeded ? "SUCCEEDED" : result.status,
        failureReason: succeeded ? null : `Square status ${result.status}`,
      },
    });

    void audit({
      organizationId: inv.organizationId,
      actorId: input.actorId,
      action: "billing.charge",
      entityType: "Charge",
      entityId: charge.id,
      after: updated,
    });

    if (succeeded) {
      if (pm.status === "FAILING") await prisma.paymentMethod.update({ where: { id: pm.id }, data: { status: "ACTIVE" } });
      await onInvoicePaid(inv.id, { paidCents: amountCents, method: "CARD", chargeId: charge.id, actorId: input.actorId });
    } else {
      await onInvoiceChargeFailed(inv.id, { reason: `Square status ${result.status}`, chargeId: charge.id, actorId: input.actorId });
    }

    return updated;
  } catch (err: unknown) {
    const reason = squareFailureReason(err);
    await prisma.charge.update({
      where: { id: charge.id },
      data: { status: "FAILED", failureReason: reason.slice(0, 500) },
    });
    await prisma.paymentMethod.update({ where: { id: pm.id }, data: { status: "FAILING" } }).catch(() => {});
    void audit({
      organizationId: inv.organizationId,
      actorId: input.actorId,
      action: "billing.charge",
      entityType: "Charge",
      entityId: charge.id,
      metadata: { failed: true, error: reason },
    });
    await onInvoiceChargeFailed(inv.id, { reason, chargeId: charge.id, actorId: input.actorId });
    throw err instanceof Error ? err : new Error(reason);
  }
}

/** Charge the member's default card (used by cron + "retry" actions). */
export async function chargeInvoiceWithDefaultCard(invoiceId: string, actorId?: string) {
  const prisma = getPrisma();
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { memberId: true } });
  if (!inv) throw new Error("Invoice not found");
  const pm = await prisma.paymentMethod.findFirst({
    where: { memberId: inv.memberId, status: { not: "EXPIRED" }, squareCardId: { not: null } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  if (!pm) throw new Error("No card on file");
  return runCharge({ invoiceId, paymentMethodId: pm.id, actorId });
}

/**
 * Charge a one-time Web Payments SDK nonce (hosted pay page, day pass, signup
 * without vaulting). Does NOT store a card.
 */
export async function chargeInvoiceWithSource(input: {
  invoiceId: string;
  sourceId: string;
  verificationToken?: string | null;
  buyerEmail?: string | null;
  actorId?: string | null;
  note?: string;
}) {
  if (!isSquareConfigured()) throw new Error("Online payments are not available right now.");
  const prisma = getPrisma();
  const inv = await loadInvoiceWithMember(input.invoiceId);
  if ((PAID_STATUSES as readonly string[]).includes(inv.status)) throw new Error("Invoice already paid");
  if (inv.status === "CANCELLED") throw new Error("Invoice was cancelled");
  const amountCents = invoiceRemainingCents(inv);
  if (amountCents <= 0) throw new Error("Nothing to charge");

  const attemptCount = await prisma.charge.count({ where: { invoiceId: inv.id } });
  const idempotencyKey = `inv_${inv.id}_attempt_${attemptCount + 1}`;
  const charge = await prisma.charge.create({
    data: {
      invoiceId: inv.id,
      memberId: inv.memberId,
      subscriptionId: inv.subscriptionId,
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
      sourceId: input.sourceId,
      idempotencyKey,
      verificationToken: input.verificationToken,
      buyerEmailAddress: input.buyerEmail ?? inv.member.email,
      note: input.note ?? `Invoice #${inv.number}`,
      referenceId: inv.id,
    });
    const succeeded = result.status === "COMPLETED" || result.status === "APPROVED";
    const updated = await prisma.charge.update({
      where: { id: charge.id },
      data: { squarePaymentId: result.id, status: succeeded ? "SUCCEEDED" : result.status },
    });
    void audit({ organizationId: inv.organizationId, actorId: input.actorId ?? undefined, action: "billing.charge", entityType: "Charge", entityId: charge.id, after: updated, metadata: { source: "nonce" } });
    if (succeeded) {
      await onInvoicePaid(inv.id, { paidCents: amountCents, method: "CARD", chargeId: charge.id, actorId: input.actorId });
    } else {
      await onInvoiceChargeFailed(inv.id, { reason: `Square status ${result.status}`, chargeId: charge.id, actorId: input.actorId });
    }
    return { charge: updated, succeeded, receiptUrl: result.receiptUrl ?? null };
  } catch (err: unknown) {
    const reason = squareFailureReason(err);
    await prisma.charge.update({ where: { id: charge.id }, data: { status: "FAILED", failureReason: reason.slice(0, 500) } });
    await onInvoiceChargeFailed(inv.id, { reason, chargeId: charge.id, actorId: input.actorId });
    throw err instanceof Error ? err : new Error(reason);
  }
}

export type ManualPaymentMethod = "CASH" | "CHECK" | "OTHER" | "CREDIT";

/**
 * Record an offline payment (cash/check/other) or apply account credit.
 * Creates a SUCCEEDED Charge row without a Square id so it shows in the ledger.
 */
export async function markInvoicePaidManually(input: {
  invoiceId: string;
  method: ManualPaymentMethod;
  amountCents?: number;
  note?: string;
  actorId?: string;
}) {
  const prisma = getPrisma();
  const inv = await loadInvoiceWithMember(input.invoiceId);
  if ((PAID_STATUSES as readonly string[]).includes(inv.status)) throw new Error("Invoice already paid");
  if (inv.status === "CANCELLED") throw new Error("Invoice was written off");

  // Manual/cash payment should not carry a card surcharge
  let amountCents = input.amountCents ?? invoiceRemainingCents(inv);
  if (input.amountCents == null && inv.surchargeCents > 0 && input.method !== "CREDIT") {
    await prisma.invoice.update({ where: { id: inv.id }, data: { surchargeCents: 0, totalCents: inv.totalCents - inv.surchargeCents } });
    amountCents -= inv.surchargeCents;
  }
  if (amountCents <= 0) throw new Error("Nothing to record");

  if (input.method === "CREDIT") {
    const balance = await getCreditBalanceCents(inv.memberId);
    if (balance < amountCents) throw new Error(`Insufficient credit (balance $${(balance / 100).toFixed(2)})`);
    await addCredit({ memberId: inv.memberId, amountCents: -amountCents, type: "ADJUSTMENT", reason: `Applied to invoice #${inv.number}`, actorId: input.actorId });
  }

  const attemptCount = await prisma.charge.count({ where: { invoiceId: inv.id } });
  const charge = await prisma.charge.create({
    data: {
      invoiceId: inv.id,
      memberId: inv.memberId,
      subscriptionId: inv.subscriptionId,
      organizationId: inv.organizationId,
      locationId: inv.locationId,
      amountCents,
      status: "SUCCEEDED",
      idempotencyKey: `manual_${inv.id}_${attemptCount + 1}`,
      attempt: attemptCount + 1,
      failureReason: null,
    },
  });
  void audit({
    organizationId: inv.organizationId,
    actorId: input.actorId,
    action: "billing.charge",
    entityType: "Charge",
    entityId: charge.id,
    after: charge,
    metadata: { manual: true, method: input.method, note: input.note },
  });
  if (input.note) {
    await prisma.invoice.update({
      where: { id: inv.id },
      data: { adminNotes: [inv.adminNotes, `[${input.method}] ${input.note}`].filter(Boolean).join("\n") },
    });
  }
  await onInvoicePaid(inv.id, { paidCents: amountCents, method: input.method, chargeId: charge.id, actorId: input.actorId });
  return charge;
}

export async function writeOffInvoice(invoiceId: string, opts: { reason?: string; actorId?: string }) {
  const prisma = getPrisma();
  const inv = await loadInvoiceWithMember(invoiceId);
  if ((PAID_STATUSES as readonly string[]).includes(inv.status)) throw new Error("Paid invoices cannot be written off — refund instead");
  const after = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: "CANCELLED",
      nextRetryAt: null,
      adminNotes: [inv.adminNotes, `Written off${opts.reason ? `: ${opts.reason}` : ""}`].filter(Boolean).join("\n"),
    },
  });
  void audit({
    organizationId: inv.organizationId,
    actorId: opts.actorId,
    action: "billing.write-off",
    entityType: "Invoice",
    entityId: invoiceId,
    before: { status: inv.status },
    after: { status: "CANCELLED" },
    metadata: { reason: opts.reason },
  });
  const desired = await computeDesiredAccessState(inv.memberId);
  void applyAccessState(inv.memberId, desired);
  return after;
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export type RefundInput = {
  chargeId: string;
  amountCents: number;
  reason?: string;
  actorId?: string;
  /** Issue as account credit instead of back to the card. */
  asCredit?: boolean;
};

export async function refundCharge(input: RefundInput) {
  const prisma = getPrisma();
  const charge = await prisma.charge.findUnique({
    where: { id: input.chargeId },
    include: { invoice: true, member: true, refunds: true },
  });
  if (!charge) throw new Error("Charge not found");
  if (charge.status !== "SUCCEEDED" && charge.status !== "PARTIALLY_REFUNDED") throw new Error("Only successful charges can be refunded");

  const alreadyRefunded = charge.refunds.reduce((s, r) => s + r.amountCents, 0);
  if (input.amountCents <= 0 || input.amountCents > charge.amountCents - alreadyRefunded) {
    throw new Error("Invalid refund amount");
  }

  let squareRefundId: string | null = null;
  let status = "COMPLETED";
  if (input.asCredit) {
    await addCredit({ memberId: charge.memberId!, amountCents: input.amountCents, type: "REFUND_AS_CREDIT", reason: input.reason ?? `Refund of charge ${charge.id}`, actorId: input.actorId });
  } else if (charge.squarePaymentId) {
    if (!isSquareConfigured()) throw new Error("Square is not configured — issue the refund as account credit or record it manually");
    const idempotencyKey = `refund_${charge.id}_${alreadyRefunded + input.amountCents}`;
    const sq = await squareCreateRefund({
      paymentId: charge.squarePaymentId,
      amountCents: input.amountCents,
      idempotencyKey,
      reason: input.reason,
    });
    squareRefundId = sq.id;
    status = sq.status;
  } else {
    status = "MANUAL"; // cash/other charge — refund recorded offline
  }

  const refund = await prisma.refund.create({
    data: {
      chargeId: charge.id,
      invoiceId: charge.invoiceId,
      amountCents: input.amountCents,
      reason: input.reason ?? null,
      squareRefundId,
      status,
      refundedById: input.actorId ?? null,
    },
  });

  const totalRefundedOnCharge = alreadyRefunded + input.amountCents;
  await prisma.charge.update({
    where: { id: charge.id },
    data: { status: totalRefundedOnCharge >= charge.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED" },
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
    metadata: { chargeId: charge.id, asCredit: !!input.asCredit },
  });

  void adminNotify({
    organizationId: charge.organizationId,
    locationId: charge.locationId,
    kind: "billing.refund-issued",
    severity: "WARN",
    title: `Refund issued ($${(input.amountCents / 100).toFixed(2)})`,
    body: `Member: ${charge.member?.firstName ?? "?"} ${charge.member?.lastName ?? ""}. Reason: ${input.reason ?? "—"}`,
    link: charge.locationId ? adminRoutes.loc.billing.payments(await locationSlug(charge.locationId)) : undefined,
    data: { refundId: refund.id, chargeId: charge.id },
  });

  if (charge.memberId) {
    await emitMemberEvent("payment.refunded", {
      memberId: charge.memberId,
      locationId: charge.locationId,
      organizationId: charge.organizationId,
      refs: { invoiceId: charge.invoiceId ?? undefined, chargeId: charge.id },
      actorAdminId: input.actorId ?? null,
      vars: { amount: (input.amountCents / 100).toFixed(2), reason: input.reason ?? null, invoiceNumber: charge.invoice?.number ?? null, asCredit: input.asCredit ? 1 : 0 },
    });
  }

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
// Payment methods (Square cards on file)
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

/** Create the Square customer for a member if we don't have one yet. */
export async function ensureSquareCustomer(memberId: string): Promise<string> {
  if (!isSquareConfigured()) throw new Error("Square is not configured");
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) throw new Error("Member not found");
  if (member.squareCustomerId) return member.squareCustomerId;
  const customer = await squareCreateCustomer({
    emailAddress: member.email,
    givenName: member.firstName,
    familyName: member.lastName,
    phoneNumber: member.phone || undefined,
    referenceId: member.id,
  });
  await prisma.member.update({ where: { id: memberId }, data: { squareCustomerId: customer.id } });
  return customer.id;
}

/**
 * Vault a tokenized card as a PaymentMethod on the member (admin, portal, signup).
 * The first card (or `setDefault`) becomes the default.
 */
export async function vaultCard(input: {
  memberId: string;
  sourceId: string;
  verificationToken?: string | null;
  setDefault?: boolean;
  actorId?: string | null;
  source?: "admin" | "portal" | "signup";
}) {
  if (!isSquareConfigured()) throw new Error("Square is not configured");
  const prisma = getPrisma();
  const customerId = await ensureSquareCustomer(input.memberId);
  const member = await prisma.member.findUnique({ where: { id: input.memberId }, select: { firstName: true, lastName: true, organizationId: true, locationId: true } });
  const card = await squareCreateCardOnFile({
    customerId,
    sourceId: input.sourceId,
    verificationToken: input.verificationToken,
    idempotencyKey: `card_${input.memberId}_${crypto.randomUUID()}`,
    cardholderName: member ? `${member.firstName} ${member.lastName}` : null,
    referenceId: input.memberId,
  });

  const existingCount = await prisma.paymentMethod.count({ where: { memberId: input.memberId, status: { not: "EXPIRED" } } });
  const makeDefault = input.setDefault ?? existingCount === 0;

  const pm = await prisma.paymentMethod.upsert({
    where: { squareCardId: card.id },
    create: {
      memberId: input.memberId,
      squareCardId: card.id,
      source: "CARD",
      brand: card.brand,
      last4: card.last4,
      expMonth: card.expMonth,
      expYear: card.expYear,
      isDefault: false,
      status: "ACTIVE",
    },
    update: { brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear, status: "ACTIVE" },
  });
  if (makeDefault) await setDefaultPaymentMethod(input.memberId, pm.id, input.actorId ?? undefined);

  void audit({
    organizationId: member?.organizationId ?? null,
    actorId: input.actorId ?? undefined,
    action: "billing.payment-method-add",
    entityType: "PaymentMethod",
    entityId: pm.id,
    after: { brand: pm.brand, last4: pm.last4, expMonth: pm.expMonth, expYear: pm.expYear, isDefault: makeDefault },
    metadata: { source: input.source ?? "admin" },
  });
  return prisma.paymentMethod.findUniqueOrThrow({ where: { id: pm.id } });
}

/** Disable a card at Square and remove it locally (promotes another card to default). */
export async function removePaymentMethod(paymentMethodId: string, actorId?: string | null) {
  const prisma = getPrisma();
  const pm = await prisma.paymentMethod.findUnique({ where: { id: paymentMethodId } });
  if (!pm) throw new Error("Payment method not found");
  if (pm.squareCardId && isSquareConfigured()) {
    await squareDisableCard(pm.squareCardId).catch((e) => console.warn("[billing] square disable card failed", e));
  }
  await prisma.paymentMethod.delete({ where: { id: paymentMethodId } });
  if (pm.isDefault) {
    const next = await prisma.paymentMethod.findFirst({ where: { memberId: pm.memberId, status: { not: "EXPIRED" } }, orderBy: { createdAt: "desc" } });
    if (next) await prisma.paymentMethod.update({ where: { id: next.id }, data: { isDefault: true } });
  }
  void audit({
    actorId: actorId ?? undefined,
    action: "billing.payment-method-remove",
    entityType: "PaymentMethod",
    entityId: paymentMethodId,
    before: { brand: pm.brand, last4: pm.last4 },
  });
}

// ---------------------------------------------------------------------------
// Receipts / pay links (email via lib/notify)
// ---------------------------------------------------------------------------

function esc(s: string | null | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function money(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

async function loadInvoiceForEmail(invoiceId: string) {
  return getPrisma().invoice.findUnique({
    where: { id: invoiceId },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      member: { select: { firstName: true, lastName: true, email: true } },
      location: { select: { name: true, businessName: true, currency: true, addressLine1: true, city: true, state: true, zip: true, email: true, phone: true } },
      charges: { where: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] } }, include: { paymentMethod: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

function emailShell(location: { name: string; businessName: string | null; addressLine1: string | null; city: string | null; state: string | null; zip: string | null; email: string | null; phone: string | null }, inner: string) {
  const biz = location.businessName ?? location.name;
  const addr = [location.addressLine1, [location.city, location.state].filter(Boolean).join(", "), location.zip].filter(Boolean).join(" · ");
  return `<div style="font-family:-apple-system,Helvetica,sans-serif;padding:24px;color:#0f172a;max-width:560px;margin:auto">
  ${inner}
  <p style="margin-top:24px;font-size:12px;color:#94a3b8;">${esc(biz)}${addr ? ` · ${esc(addr)}` : ""}${location.phone ? ` · ${esc(location.phone)}` : ""}</p>
</div>`;
}

function linesTable(inv: NonNullable<Awaited<ReturnType<typeof loadInvoiceForEmail>>>) {
  const cur = inv.location.currency;
  const rows = inv.lineItems
    .map((l) => `<tr><td style="padding:6px 0;color:#334155;">${esc(l.description)}${l.quantity > 1 ? ` × ${l.quantity}` : ""}</td><td style="padding:6px 0;text-align:right;">${money(l.totalCents, cur)}</td></tr>`)
    .join("");
  const extra = [
    inv.discountCents > 0 ? `<tr><td style="padding:6px 0;color:#16a34a;">Discount</td><td style="padding:6px 0;text-align:right;color:#16a34a;">−${money(inv.discountCents, cur)}</td></tr>` : "",
    inv.taxCents > 0 ? `<tr><td style="padding:6px 0;color:#64748b;">Tax</td><td style="padding:6px 0;text-align:right;">${money(inv.taxCents, cur)}</td></tr>` : "",
    inv.surchargeCents > 0 ? `<tr><td style="padding:6px 0;color:#64748b;">Card surcharge</td><td style="padding:6px 0;text-align:right;">${money(inv.surchargeCents, cur)}</td></tr>` : "",
  ].join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}${extra}
  <tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;font-weight:600;">Total</td><td style="padding:10px 0;border-top:1px solid #e2e8f0;text-align:right;font-weight:600;">${money(inv.totalCents, cur)}</td></tr></table>`;
}

export async function sendReceiptEmail(invoiceId: string) {
  const inv = await loadInvoiceForEmail(invoiceId);
  if (!inv || !inv.member.email) return false;
  const pm = inv.charges[0]?.paymentMethod;
  const paidWith = pm ? `${pm.brand} •••• ${pm.last4}` : inv.charges[0]?.squarePaymentId ? "card" : "cash / other";
  const html = emailShell(
    inv.location,
    `<h1 style="margin:0 0 8px;font-size:20px;">Receipt — Invoice #${inv.number}</h1>
  <p style="margin:0 0 16px;color:#475569;">Hi ${esc(inv.member.firstName)}, thanks for your payment${inv.paidAt ? ` on ${inv.paidAt.toLocaleDateString()}` : ""}. Paid with ${esc(paidWith)}.</p>
  ${linesTable(inv)}`,
  );
  await sendEmail({ to: inv.member.email, subject: `Receipt from ${inv.location.businessName ?? inv.location.name} — #${inv.number}`, html, ledger: { memberId: inv.memberId, locationId: inv.locationId, source: "billing.receipt" } });
  return true;
}

export async function sendPayLinkEmail(invoiceId: string, opts?: { message?: string }) {
  const inv = await loadInvoiceForEmail(invoiceId);
  if (!inv || !inv.member.email) return null;
  const token = await ensurePayToken(invoiceId);
  const url = publicPayUrl(token);
  const html = emailShell(
    inv.location,
    `<h1 style="margin:0 0 8px;font-size:20px;">Invoice #${inv.number}</h1>
  <p style="margin:0 0 16px;color:#475569;">Hi ${esc(inv.member.firstName)}, ${inv.description ? esc(inv.description) + " — " : ""}${money(inv.totalCents - inv.refundedCents, inv.location.currency)} is due ${inv.dueDate.toLocaleDateString()}.</p>
  ${opts?.message ? `<p style="margin:0 0 16px;color:#334155;">${esc(opts.message)}</p>` : ""}
  ${linesTable(inv)}
  <p style="margin:20px 0;"><a href="${url}" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;">Pay now</a></p>
  <p style="font-size:12px;color:#94a3b8;">Or paste this link in your browser: ${url}</p>`,
  );
  await sendEmail({ to: inv.member.email, subject: `Invoice #${inv.number} from ${inv.location.businessName ?? inv.location.name}`, html, ledger: { memberId: inv.memberId, locationId: inv.locationId, source: "billing.pay-link" } });
  return url;
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
  const where: Prisma.InvoiceWhereInput = { paidAt: { gte: opts.start, lt: opts.end }, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } };
  if (opts.locationId) where.locationId = opts.locationId;
  if (opts.organizationId) where.organizationId = opts.organizationId;

  const invoices = await prisma.invoice.findMany({ where, select: { totalCents: true, refundedCents: true } });
  const grossCents = invoices.reduce((s, i) => s + i.totalCents, 0);
  const refundedCents = invoices.reduce((s, i) => s + i.refundedCents, 0);
  return { grossCents, refundedCents, netCents: grossCents - refundedCents, count: invoices.length };
}

export async function getOverdueSummary(locationId?: string) {
  const prisma = getPrisma();
  const where: Prisma.InvoiceWhereInput = { status: { in: [...OVERDUE_STATUSES] } };
  if (locationId) where.locationId = locationId;
  const invoices = await prisma.invoice.findMany({ where, select: { totalCents: true, refundedCents: true } });
  return {
    count: invoices.length,
    overdueCents: invoices.reduce((s, i) => s + (i.totalCents - i.refundedCents), 0),
  };
}

// ---------------------------------------------------------------------------
// Invoice querying (payments page + CSV export share this)
// ---------------------------------------------------------------------------

export type InvoiceTab = "PAID" | "SCHEDULED" | "OVERDUE" | "REFUNDED" | "CANCELLED" | "ALL";

export const INVOICE_TAB_STATUSES: Record<InvoiceTab, string[] | null> = {
  PAID: ["PAID"],
  SCHEDULED: ["SCHEDULED"],
  OVERDUE: ["PAST_DUE", "FAILED"],
  REFUNDED: ["REFUNDED", "PARTIALLY_REFUNDED", "CHARGEBACK"],
  CANCELLED: ["CANCELLED"],
  ALL: null,
};

export type InvoiceFilter = {
  locationId: string;
  tab?: InvoiceTab;
  q?: string | null; // member name / email
  number?: string | null; // invoice #
  txn?: string | null; // square payment id
  last4?: string | null;
  memberId?: string | null;
  memberStatus?: string | null;
  scheduledFrom?: Date | null;
  scheduledTo?: Date | null;
  paidFrom?: Date | null;
  paidTo?: Date | null;
  take?: number;
  skip?: number;
};

export function buildInvoiceWhere(f: InvoiceFilter): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = { locationId: f.locationId };
  const statuses = INVOICE_TAB_STATUSES[f.tab ?? "ALL"];
  if (statuses) where.status = { in: statuses };
  if (f.memberId) where.memberId = f.memberId;
  if (f.number && /^\d+$/.test(f.number.trim())) where.number = Number(f.number.trim());
  if (f.txn) where.charges = { some: { squarePaymentId: { contains: f.txn.trim() } } };
  if (f.last4) where.charges = { some: { ...(where.charges as Prisma.ChargeListRelationFilter | undefined)?.some, paymentMethod: { last4: f.last4.trim() } } };
  const memberWhere: Prisma.MemberWhereInput = {};
  if (f.q) {
    const q = f.q.trim();
    memberWhere.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { fullName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }
  if (f.memberStatus) memberWhere.status = f.memberStatus;
  if (Object.keys(memberWhere).length) where.member = memberWhere;
  if (f.scheduledFrom || f.scheduledTo) where.dueDate = { gte: f.scheduledFrom ?? undefined, lt: f.scheduledTo ?? undefined };
  if (f.paidFrom || f.paidTo) where.paidAt = { gte: f.paidFrom ?? undefined, lt: f.paidTo ?? undefined };
  return where;
}

export async function queryInvoices(f: InvoiceFilter) {
  const prisma = getPrisma();
  const where = buildInvoiceWhere(f);
  const tab = f.tab ?? "ALL";
  const orderBy: Prisma.InvoiceOrderByWithRelationInput[] =
    tab === "PAID" || tab === "REFUNDED" ? [{ paidAt: "desc" }, { createdAt: "desc" }] : tab === "SCHEDULED" ? [{ dueDate: "asc" }] : [{ dueDate: "desc" }];
  return prisma.invoice.findMany({
    where,
    orderBy,
    take: f.take ?? 200,
    skip: f.skip ?? 0,
    include: {
      member: { select: { id: true, firstName: true, lastName: true, email: true, status: true } },
      subscription: { select: { id: true, plan: { select: { name: true } } } },
      charges: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, squarePaymentId: true, failureReason: true, paymentMethod: { select: { brand: true, last4: true } } } },
    },
  });
}

export async function countInvoicesByTab(locationId: string, base?: Omit<InvoiceFilter, "locationId" | "tab">) {
  const prisma = getPrisma();
  const tabs: InvoiceTab[] = ["PAID", "SCHEDULED", "OVERDUE", "REFUNDED", "CANCELLED"];
  const counts = await Promise.all(tabs.map((tab) => prisma.invoice.count({ where: buildInvoiceWhere({ ...base, locationId, tab }) })));
  return Object.fromEntries(tabs.map((t, i) => [t, counts[i]])) as Record<Exclude<InvoiceTab, "ALL">, number>;
}

export type InvoiceRow = Awaited<ReturnType<typeof queryInvoices>>[number];

export function invoicesToCsv(rows: InvoiceRow[], currency = "USD"): string {
  const header = ["Invoice #", "Member", "Email", "Status", "Description", "Plan", "Subtotal", "Discount", "Tax", "Surcharge", "Total", "Refunded", "Due", "Paid", "Card", "Square payment id", "Decline reason", "Pay link"];
  const lines = rows.map((r) => [
    r.number,
    `${r.member.firstName} ${r.member.lastName}`,
    r.member.email,
    r.status,
    r.description ?? "",
    r.subscription?.plan.name ?? "",
    (r.subtotalCents / 100).toFixed(2),
    (r.discountCents / 100).toFixed(2),
    (r.taxCents / 100).toFixed(2),
    (r.surchargeCents / 100).toFixed(2),
    (r.totalCents / 100).toFixed(2),
    (r.refundedCents / 100).toFixed(2),
    r.dueDate.toISOString().slice(0, 10),
    r.paidAt ? r.paidAt.toISOString().slice(0, 10) : "",
    r.charges[0]?.paymentMethod ? `${r.charges[0].paymentMethod.brand} ${r.charges[0].paymentMethod.last4}` : "",
    r.charges[0]?.squarePaymentId ?? "",
    r.lastFailureReason ?? r.charges[0]?.failureReason ?? "",
    r.payToken ? publicPayUrl(r.payToken) : "",
  ]);
  return toCsv([header, ...lines], currency);
}

export function toCsv(rows: (string | number | null | undefined)[][], _currency?: string): string {
  void _currency;
  return rows
    .map((row) => row.map((v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Accounting ledger (payments + refunds + POS sales, with GL codes)
// ---------------------------------------------------------------------------

export type LedgerRow = {
  id: string;
  date: Date;
  type: "Payment" | "Refund" | "Sale" | "Sale refund";
  memberId: string | null;
  memberName: string;
  description: string;
  method: string;
  amountCents: number; // net of tax & surcharge
  taxCents: number;
  surchargeCents: number;
  totalCents: number; // signed (refunds negative)
  glCode: string | null;
  incomeCategory: string | null;
  reference: string | null; // square payment / refund id
  invoiceId: string | null;
  invoiceNumber: number | null;
};

export async function buildLedger(opts: { locationId: string; start: Date; end: Date }): Promise<LedgerRow[]> {
  const prisma = getPrisma();
  const [charges, refunds, sales] = await Promise.all([
    prisma.charge.findMany({
      where: { locationId: opts.locationId, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] }, createdAt: { gte: opts.start, lt: opts.end } },
      include: {
        member: { select: { id: true, firstName: true, lastName: true } },
        paymentMethod: { select: { brand: true, last4: true } },
        invoice: { select: { id: true, number: true, description: true, totalCents: true, taxCents: true, surchargeCents: true, subscription: { select: { plan: { select: { name: true, glCode: true, incomeCategory: true } } } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.refund.findMany({
      where: { createdAt: { gte: opts.start, lt: opts.end }, charge: { locationId: opts.locationId } },
      include: {
        charge: { include: { member: { select: { id: true, firstName: true, lastName: true } }, paymentMethod: { select: { brand: true, last4: true } } } },
        invoice: { select: { id: true, number: true, description: true, subscription: { select: { plan: { select: { name: true, glCode: true, incomeCategory: true } } } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.sale.findMany({
      where: { locationId: opts.locationId, status: { in: ["PAID", "REFUNDED"] }, createdAt: { gte: opts.start, lt: opts.end } },
      include: { lineItems: { include: { product: { select: { glCode: true, incomeCategory: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const saleMemberIds = Array.from(new Set(sales.map((s) => s.memberId).filter((x): x is string => Boolean(x))));
  const saleMembers = saleMemberIds.length ? await prisma.member.findMany({ where: { id: { in: saleMemberIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const saleMemberById = new Map(saleMembers.map((m) => [m.id, m]));

  const rows: LedgerRow[] = [];
  for (const c of charges) {
    const inv = c.invoice;
    const full = inv ? c.amountCents >= inv.totalCents : false;
    const taxCents = inv && full ? inv.taxCents : 0;
    const surchargeCents = inv && full ? inv.surchargeCents : 0;
    rows.push({
      id: `charge_${c.id}`,
      date: c.createdAt,
      type: "Payment",
      memberId: c.member?.id ?? null,
      memberName: c.member ? `${c.member.firstName} ${c.member.lastName}` : "—",
      description: inv?.description ?? inv?.subscription?.plan.name ?? "Payment",
      method: c.squarePaymentId ? (c.paymentMethod ? `${c.paymentMethod.brand} •••• ${c.paymentMethod.last4}` : "Card") : (c.idempotencyKey?.startsWith("manual_") ? "Cash / other" : "Manual"),
      amountCents: c.amountCents - taxCents - surchargeCents,
      taxCents,
      surchargeCents,
      totalCents: c.amountCents,
      glCode: inv?.subscription?.plan.glCode ?? null,
      incomeCategory: inv?.subscription?.plan.incomeCategory ?? null,
      reference: c.squarePaymentId,
      invoiceId: inv?.id ?? null,
      invoiceNumber: inv?.number ?? null,
    });
  }
  for (const r of refunds) {
    const m = r.charge.member;
    rows.push({
      id: `refund_${r.id}`,
      date: r.createdAt,
      type: "Refund",
      memberId: m?.id ?? null,
      memberName: m ? `${m.firstName} ${m.lastName}` : "—",
      description: `Refund${r.reason ? `: ${r.reason}` : ""}${r.invoice?.description ? ` — ${r.invoice.description}` : ""}`,
      method: r.squareRefundId ? (r.charge.paymentMethod ? `${r.charge.paymentMethod.brand} •••• ${r.charge.paymentMethod.last4}` : "Card") : r.status === "MANUAL" ? "Cash / other" : "Account credit",
      amountCents: -r.amountCents,
      taxCents: 0,
      surchargeCents: 0,
      totalCents: -r.amountCents,
      glCode: r.invoice?.subscription?.plan.glCode ?? null,
      incomeCategory: r.invoice?.subscription?.plan.incomeCategory ?? null,
      reference: r.squareRefundId,
      invoiceId: r.invoice?.id ?? null,
      invoiceNumber: r.invoice?.number ?? null,
    });
  }
  for (const s of sales) {
    const m = s.memberId ? saleMemberById.get(s.memberId) : null;
    const gl = s.lineItems.find((l) => l.product?.glCode)?.product?.glCode ?? null;
    const cat = s.lineItems.find((l) => l.product?.incomeCategory)?.product?.incomeCategory ?? null;
    const sign = s.status === "REFUNDED" ? -1 : 1;
    rows.push({
      id: `sale_${s.id}`,
      date: s.status === "REFUNDED" && s.refundedAt ? s.refundedAt : s.createdAt,
      type: s.status === "REFUNDED" ? "Sale refund" : "Sale",
      memberId: m?.id ?? null,
      memberName: m ? `${m.firstName} ${m.lastName}` : s.customerName ?? "Walk-in",
      description: `Sale #${s.number}: ${s.lineItems.map((l) => l.description).join(", ").slice(0, 120)}`,
      method: s.paymentKind.replace("_", " ").toLowerCase().replace(/^\w/, (ch) => ch.toUpperCase()),
      amountCents: sign * (s.totalCents - s.taxCents),
      taxCents: sign * s.taxCents,
      surchargeCents: 0,
      totalCents: sign * s.totalCents,
      glCode: gl,
      incomeCategory: cat,
      reference: s.chargeId,
      invoiceId: null,
      invoiceNumber: null,
    });
  }
  rows.sort((a, b) => b.date.getTime() - a.date.getTime());
  return rows;
}

export function ledgerToCsv(rows: LedgerRow[]): string {
  const header = ["Date", "Type", "Member", "Description", "Method", "Amount", "Tax", "Surcharge", "Total", "GL code", "Income category", "Reference", "Invoice #"];
  return toCsv([
    header,
    ...rows.map((r) => [
      r.date.toISOString(),
      r.type,
      r.memberName,
      r.description,
      r.method,
      (r.amountCents / 100).toFixed(2),
      (r.taxCents / 100).toFixed(2),
      (r.surchargeCents / 100).toFixed(2),
      (r.totalCents / 100).toFixed(2),
      r.glCode ?? "",
      r.incomeCategory ?? "",
      r.reference ?? "",
      r.invoiceNumber ?? "",
    ]),
  ]);
}

/** Outstanding (open invoices) and credit balances per member for the "Member balances" tab. */
export async function memberBalances(locationId: string) {
  const prisma = getPrisma();
  const [open, credits] = await Promise.all([
    prisma.invoice.groupBy({ by: ["memberId"], where: { locationId, status: { in: [...OPEN_STATUSES] } }, _sum: { totalCents: true, refundedCents: true }, _count: true }),
    prisma.memberCredit.groupBy({ by: ["memberId"], where: { member: { locationId } }, _sum: { amountCents: true } }),
  ]);
  const ids = Array.from(new Set([...open.map((o) => o.memberId), ...credits.map((c) => c.memberId)]));
  const members = ids.length ? await prisma.member.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, status: true } }) : [];
  const byId = new Map(members.map((m) => [m.id, m]));
  const openById = new Map(open.map((o) => [o.memberId, o]));
  const creditById = new Map(credits.map((c) => [c.memberId, c._sum.amountCents ?? 0]));
  return ids
    .map((id) => {
      const m = byId.get(id);
      const o = openById.get(id);
      const outstanding = o ? (o._sum.totalCents ?? 0) - (o._sum.refundedCents ?? 0) : 0;
      const credit = creditById.get(id) ?? 0;
      return { memberId: id, name: m ? `${m.firstName} ${m.lastName}` : "—", status: m?.status ?? "—", openInvoices: o?._count ?? 0, outstandingCents: outstanding, creditCents: credit, netCents: outstanding - credit };
    })
    .filter((r) => r.outstandingCents !== 0 || r.creditCents !== 0)
    .sort((a, b) => b.netCents - a.netCents);
}

// ---------------------------------------------------------------------------
// Location billing settings
// ---------------------------------------------------------------------------

export type BillingSettings = {
  currency: string;
  taxRateBps: number;
  cardSurchargeBps: number;
  dunningRetryDays: number[];
  lateFeeCents: number;
  overdueBlockDays: number | null;
};

export const DEFAULT_DUNNING_RETRY_DAYS = [1, 3, 7];

export function parseDunningRetryDays(v: unknown): number[] {
  if (!Array.isArray(v)) return DEFAULT_DUNNING_RETRY_DAYS;
  const days = v.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0);
  return days.length ? days : DEFAULT_DUNNING_RETRY_DAYS;
}

export function billingSettingsOf(loc: Pick<Location, "currency" | "taxRateBps" | "cardSurchargeBps" | "dunningRetryDays" | "lateFeeCents" | "overdueBlockDays">): BillingSettings {
  return {
    currency: loc.currency,
    taxRateBps: loc.taxRateBps,
    cardSurchargeBps: loc.cardSurchargeBps,
    dunningRetryDays: parseDunningRetryDays(loc.dunningRetryDays),
    lateFeeCents: loc.lateFeeCents,
    overdueBlockDays: loc.overdueBlockDays,
  };
}

export async function updateBillingSettings(locationId: string, patch: Partial<BillingSettings>, actorId?: string) {
  const prisma = getPrisma();
  const before = await prisma.location.findUnique({ where: { id: locationId } });
  if (!before) throw new Error("Location not found");
  const data: Prisma.LocationUpdateInput = {};
  if (patch.currency !== undefined) data.currency = String(patch.currency).toUpperCase().slice(0, 3) || "USD";
  if (patch.taxRateBps !== undefined) data.taxRateBps = clampInt(patch.taxRateBps, 0, 5000);
  if (patch.cardSurchargeBps !== undefined) data.cardSurchargeBps = clampInt(patch.cardSurchargeBps, 0, 1000);
  if (patch.dunningRetryDays !== undefined) data.dunningRetryDays = parseDunningRetryDays(patch.dunningRetryDays);
  if (patch.lateFeeCents !== undefined) data.lateFeeCents = clampInt(patch.lateFeeCents, 0, 100_000);
  if (patch.overdueBlockDays !== undefined) data.overdueBlockDays = patch.overdueBlockDays == null ? null : clampInt(patch.overdueBlockDays, 0, 365);
  const after = await prisma.location.update({ where: { id: locationId }, data });
  void audit({
    organizationId: before.organizationId,
    actorId,
    action: "settings.update",
    entityType: "Location",
    entityId: locationId,
    before: billingSettingsOf(before),
    after: billingSettingsOf(after),
    metadata: { section: "billing" },
  });
  return billingSettingsOf(after);
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
