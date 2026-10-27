/**
 * Membership service — plan catalog, subscriptions, cancel/freeze/extend/proration
 * workflows, comp memberships, and access-state propagation.
 *
 * Design rules:
 *  - Mutations write to AuditLog and trigger AccessSync as appropriate.
 *  - Cancel/freeze default to end-of-period; immediate variants are gated upstream.
 *  - Proration is per-day, computed from the current period (startDate → paidThroughDate).
 *  - Square subscription mirroring is best-effort: we always store local state first,
 *    then sync to Square. Failures enqueue a retry via WebhookDelivery.
 *
 * Status values (string column on MembershipSubscription):
 *   PENDING | ACTIVE | FROZEN | FREEZE_SCHEDULED | CANCELLED | CANCEL_SCHEDULED | COMP
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";
import { adminNotify } from "@/lib/admin-notify";
import { emitMemberEvent } from "@/lib/events";
import { getSquareCreds, squareCancelSubscription } from "@/lib/square";
import type { MembershipSubscription, MembershipPlan } from "@prisma/client";
import { earlyCancelFeeDue, guestCentsFor, maxGuestsFor, membershipDisplayName } from "@/lib/membership-pricing";

export type CreatePlanInput = {
  organizationId?: string | null;
  name: string;
  description?: string | null;
  productType?: string;
  category?: string;
  priceCents: number;
  signupFeeCents?: number;
  billingCadence?: string;
  durationDays?: number | null;
  familyBundle?: boolean;
  cancellationPolicy?: any;
  refundPolicy?: any;
  freezePolicy?: any;
  kisiDoorGroups?: Record<string, number[]> | null;
  autoApplyTagIds?: string[];
  autoEnrollAutomationIds?: string[];
  allowedLocations?: string | null;
};

export async function createPlan(input: CreatePlanInput, actorId?: string) {
  const prisma = getPrisma();
  const plan = await prisma.membershipPlan.create({
    data: {
      organizationId: input.organizationId ?? null,
      name: input.name,
      description: input.description ?? null,
      productType: input.productType ?? "RECURRING",
      category: input.category ?? "MEMBER",
      priceCents: input.priceCents,
      signupFeeCents: input.signupFeeCents ?? 0,
      billingCadence: input.billingCadence ?? "MONTHLY",
      durationDays: input.durationDays ?? null,
      familyBundle: input.familyBundle ?? false,
      cancellationPolicy: input.cancellationPolicy ?? undefined,
      refundPolicy: input.refundPolicy ?? undefined,
      freezePolicy: input.freezePolicy ?? undefined,
      kisiDoorGroups: input.kisiDoorGroups ?? undefined,
      autoApplyTagIds: input.autoApplyTagIds ?? undefined,
      autoEnrollAutomationIds: input.autoEnrollAutomationIds ?? undefined,
      allowedLocations: input.allowedLocations ?? null,
    },
  });

  void audit({
    organizationId: input.organizationId ?? null,
    actorId,
    action: "membership.create",
    entityType: "MembershipPlan",
    entityId: plan.id,
    after: plan,
  });

  return plan;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export type SubscribeInput = {
  memberId: string;
  planId: string;
  locationId: string;
  startDate?: Date;
  squareSubscriptionId?: string | null;
  comp?: boolean;
};

export async function subscribeMember(input: SubscribeInput, actorId?: string) {
  const prisma = getPrisma();
  const plan = await prisma.membershipPlan.findUnique({ where: { id: input.planId } });
  if (!plan) throw new Error("Plan not found");

  const sub = await prisma.membershipSubscription.create({
    data: {
      memberId: input.memberId,
      planId: input.planId,
      locationId: input.locationId,
      status: input.comp ? "COMP" : "PENDING",
      startDate: input.startDate ?? new Date(),
      priceCents: plan.priceCents,
      signupFeeCents: plan.signupFeeCents,
      billingCadence: plan.billingCadence,
      squareSubscriptionId: input.squareSubscriptionId ?? null,
    },
    include: { plan: true },
  });

  void audit({
    actorId,
    action: "membership.create",
    entityType: "MembershipSubscription",
    entityId: sub.id,
    after: sub,
    metadata: { planId: input.planId, comp: input.comp },
  });

  if (input.comp) {
    const desired = await computeDesiredAccessState(input.memberId);
    void applyAccessState(input.memberId, desired);
  }

  return sub;
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export type CancelInput = {
  subscriptionId: string;
  immediate?: boolean;
  reason: string;
  notes?: string;
  refundUnusedCents?: number;
  extendDays?: number;
  extendChargeCents?: number;
  /** Skip the promotional early-cancellation fee even if the member is inside the minimum term. */
  waiveEarlyCancelFee?: boolean;
};

export type EarlyCancelFeeResult = {
  feeCents: number;
  invoiceId: string;
  invoiceNumber: number;
  charged: boolean;
  failureReason: string | null;
};

/**
 * Cancel a subscription (immediately or at period end). When the member is
 * still inside a promotional minimum term (e.g. "first month half off, 2-month
 * minimum") the discounted amount is invoiced as an early-cancellation fee and
 * charged to the card on file; the result is returned as `earlyCancelFee`.
 * Pass `waiveEarlyCancelFee` to skip it.
 */
export async function cancelSubscription(input: CancelInput, actorId?: string) {
  const prisma = getPrisma();
  const sub = await prisma.membershipSubscription.findUnique({
    where: { id: input.subscriptionId },
    include: { member: true, plan: true },
  });
  if (!sub) throw new Error("Subscription not found");
  const earlyFeeCents = input.waiveEarlyCancelFee ? 0 : earlyCancelFeeDue(sub);

  let paidThrough = sub.paidThroughDate ?? sub.startDate;
  if (input.extendDays && input.extendDays > 0) {
    const next = new Date(paidThrough);
    next.setDate(next.getDate() + input.extendDays);
    paidThrough = next;
  }

  const isImmediate = !!input.immediate;
  const newStatus = isImmediate ? "CANCELLED" : "CANCEL_SCHEDULED";
  const updated = await prisma.membershipSubscription.update({
    where: { id: input.subscriptionId },
    data: {
      status: newStatus,
      paidThroughDate: input.extendDays ? paidThrough : undefined,
      cancelScheduledFor: isImmediate ? null : paidThrough,
      cancellationReason: input.reason,
      cancellationNotes: input.notes ?? null,
      cancelledAt: isImmediate ? new Date() : null,
      cancelledById: actorId ?? null,
      endDate: isImmediate ? new Date() : paidThrough,
      autoRenew: false,
    },
  });

  if (sub.squareSubscriptionId) {
    getSquareCreds(sub.locationId)
      .then((square) => (square ? squareCancelSubscription(square, sub.squareSubscriptionId!) : undefined))
      .catch((err) => console.warn("[membership.cancel] Square sync failed; will be retried", err));
  }

  void audit({
    organizationId: sub.member.organizationId,
    actorId,
    action: isImmediate ? "membership.cancel-immediate" : "membership.cancel-schedule",
    entityType: "MembershipSubscription",
    entityId: sub.id,
    before: { status: sub.status, paidThroughDate: sub.paidThroughDate },
    after: { status: newStatus, paidThroughDate: updated.paidThroughDate, cancelScheduledFor: updated.cancelScheduledFor },
    metadata: { reason: input.reason, refundUnusedCents: input.refundUnusedCents, extendDays: input.extendDays },
  });

  void adminNotify({
    organizationId: sub.member.organizationId,
    locationId: sub.locationId,
    kind: isImmediate ? "membership.cancelled" : "membership.cancel-scheduled",
    severity: "INFO",
    title: `${sub.member.firstName} ${sub.member.lastName} ${isImmediate ? "cancelled" : "scheduled cancellation"}`,
    body: `Plan: ${sub.plan.name}. Reason: ${input.reason}.`,
    link: `/admin/locations/${sub.locationId}/members/list/${sub.memberId}`,
    data: { subscriptionId: sub.id },
  });

  if (isImmediate) {
    if (await noOtherLiveSubscriptions(sub.memberId, sub.id)) {
      await prisma.member.update({ where: { id: sub.memberId }, data: { status: "CANCELLED" } }).catch(() => undefined);
    }
    const desired = await computeDesiredAccessState(sub.memberId);
    void applyAccessState(sub.memberId, desired);
  }

  let earlyCancelFee: EarlyCancelFeeResult | null = null;
  if (earlyFeeCents > 0) {
    const { createInvoice, chargeInvoiceWithDefaultCard } = await import("./billing.service");
    const label = `Early cancellation — ${membershipDisplayName(sub.plan.name, sub.guestCount)} (${sub.commitmentMonths}-month minimum)`;
    // Deliberately not linked via subscriptionId: onInvoicePaid treats subscription
    // invoices as period payments and would extend paidThroughDate.
    const inv = await createInvoice(
      {
        organizationId: sub.member.organizationId,
        locationId: sub.locationId,
        memberId: sub.memberId,
        description: label,
        dueDate: new Date(),
        lines: [{ description: label, unitCents: earlyFeeCents }],
      },
      actorId,
    );
    let charged = false;
    let failureReason: string | null = null;
    try {
      await chargeInvoiceWithDefaultCard(inv.id, actorId);
      charged = true;
    } catch (e) {
      failureReason = e instanceof Error ? e.message : String(e);
    }
    earlyCancelFee = { feeCents: earlyFeeCents, invoiceId: inv.id, invoiceNumber: inv.number, charged, failureReason };
    void audit({
      organizationId: sub.member.organizationId,
      actorId,
      action: "billing.invoice-edit",
      entityType: "Invoice",
      entityId: inv.id,
      metadata: { earlyCancellationFee: true, subscriptionId: sub.id, feeCents: earlyFeeCents, charged, failureReason },
    });
  }

  return Object.assign(updated, { earlyCancelFee });
}

/**
 * The most recent successful card payment for a subscription (what "Cancel now &
 * refund" gives back). Prefers charges tied to the subscription's invoices; falls
 * back to the member's latest membership charge for legacy/imported rows.
 */
export async function lastMembershipPayment(subscriptionId: string) {
  const prisma = getPrisma();
  const sub = await prisma.membershipSubscription.findUnique({ where: { id: subscriptionId }, select: { memberId: true } });
  if (!sub) return null;
  const where = { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] }, squarePaymentId: { not: null } };
  const charge =
    (await prisma.charge.findFirst({ where: { ...where, OR: [{ subscriptionId }, { invoice: { subscriptionId } }] }, orderBy: { createdAt: "desc" }, include: { refunds: { where: { status: { notIn: ["REJECTED", "FAILED"] } }, select: { amountCents: true } }, invoice: { select: { number: true, description: true } } } })) ??
    (await prisma.charge.findFirst({ where: { ...where, memberId: sub.memberId, invoice: { subscriptionId: { not: null } } }, orderBy: { createdAt: "desc" }, include: { refunds: { where: { status: { notIn: ["REJECTED", "FAILED"] } }, select: { amountCents: true } }, invoice: { select: { number: true, description: true } } } }));
  if (!charge) return null;
  const refunded = charge.refunds.reduce((s, r) => s + r.amountCents, 0);
  const refundableCents = Math.max(0, charge.amountCents - refunded);
  return { chargeId: charge.id, amountCents: charge.amountCents, refundedCents: refunded, refundableCents, paidAt: charge.createdAt, invoiceNumber: charge.invoice?.number ?? null, description: charge.invoice?.description ?? null };
}

/** True when the member has no other membership that still grants anything. */
async function noOtherLiveSubscriptions(memberId: string, exceptSubscriptionId: string) {
  const n = await getPrisma().membershipSubscription.count({
    where: { memberId, id: { not: exceptSubscriptionId }, status: { in: ["ACTIVE", "CANCEL_SCHEDULED", "FROZEN", "FREEZE_SCHEDULED", "COMP", "PENDING"] } },
  });
  return n === 0;
}

export type CancelNowInput = {
  subscriptionId: string;
  reason: string;
  notes?: string;
  /** Refund the most recent successful membership payment back to the card. */
  refundLastPayment: boolean;
  /** Partial refund override (cents). Defaults to the full refundable amount. */
  refundAmountCents?: number;
};

/**
 * "Cancel now & refund": ends the membership immediately, drops any open/scheduled
 * invoices for it, revokes door access (which removes the member from Kisi), and
 * optionally refunds the last payment. Member messages: membership.cancelled and
 * payment.refunded (the latter is emitted by refundCharge).
 */
export async function cancelNowAndRefund(input: CancelNowInput, actorId?: string) {
  const prisma = getPrisma();
  const sub = await prisma.membershipSubscription.findUnique({ where: { id: input.subscriptionId }, include: { member: true, plan: true } });
  if (!sub) throw new Error("Subscription not found");
  if (sub.status === "CANCELLED") throw new Error("This membership is already cancelled");

  const payment = input.refundLastPayment ? await lastMembershipPayment(sub.id) : null;
  if (input.refundLastPayment && (!payment || payment.refundableCents <= 0)) {
    throw new Error("No refundable card payment was found for this membership. Cancel without a refund, or refund a specific charge from the Payments tab.");
  }

  // 1. End it now (the early-cancel fee is waived — we're giving money back, not taking it).
  const cancelled = await cancelSubscription({ subscriptionId: sub.id, immediate: true, reason: input.reason, notes: input.notes, waiveEarlyCancelFee: true }, actorId);
  await prisma.membershipSubscription.update({ where: { id: sub.id }, data: { autoRenew: false, pendingPlanId: null, pendingGuestCount: null, pendingPriceCents: null, pendingChangeAt: null } });

  // 2. Nothing further should be collected for this membership.
  const open = await prisma.invoice.findMany({ where: { subscriptionId: sub.id, status: { in: ["SCHEDULED", "PAST_DUE", "FAILED"] } }, select: { id: true } });
  const { writeOffInvoice, refundCharge } = await import("./billing.service");
  for (const inv of open) await writeOffInvoice(inv.id, { reason: "Membership cancelled immediately", actorId }).catch((e) => console.warn("[cancelNow] write-off failed", inv.id, e));

  // 3. Member record
  if (await noOtherLiveSubscriptions(sub.memberId, sub.id)) {
    await prisma.member.update({ where: { id: sub.memberId }, data: { status: "CANCELLED" } }).catch(() => undefined);
  }

  // 4. Refund
  let refund: { chargeId: string; amountCents: number } | null = null;
  let refundError: string | null = null;
  if (payment) {
    const amount = Math.min(payment.refundableCents, Math.max(1, Math.round(input.refundAmountCents ?? payment.refundableCents)));
    try {
      await refundCharge({ chargeId: payment.chargeId, amountCents: amount, reason: `Membership cancelled: ${input.reason}`, actorId });
      refund = { chargeId: payment.chargeId, amountCents: amount };
    } catch (e) {
      refundError = e instanceof Error ? e.message : String(e);
      void adminNotify({
        organizationId: sub.member.organizationId,
        locationId: sub.locationId,
        kind: "integration.alert",
        severity: "ERROR",
        title: `Refund failed for ${sub.member.firstName} ${sub.member.lastName}`,
        body: `Membership was cancelled but the ${(amount / 100).toFixed(2)} refund did not go through: ${refundError}. Refund it from the Payments tab.`,
        link: `/admin/locations/${sub.locationId}/members/list/${sub.memberId}`,
        data: { subscriptionId: sub.id, chargeId: payment.chargeId },
      });
    }
  }

  void emitMemberEvent("membership.cancelled", {
    memberId: sub.memberId,
    locationId: sub.locationId,
    organizationId: sub.member.organizationId,
    actorAdminId: actorId ?? null,
    refs: { subscriptionId: sub.id },
    vars: { planName: membershipDisplayName(sub.plan.name, sub.guestCount, sub.plan.productType), reason: input.reason, dueDate: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), amount: refund ? `$${(refund.amountCents / 100).toFixed(2)}` : "" },
  });

  return { subscription: cancelled, voidedInvoices: open.length, refund, refundError };
}

export async function undoCancellation(subscriptionId: string, actorId?: string) {
  const prisma = getPrisma();
  const sub = await prisma.membershipSubscription.findUnique({
    where: { id: subscriptionId },
    include: { member: true },
  });
  if (!sub) throw new Error("Subscription not found");
  if (sub.status !== "CANCEL_SCHEDULED") throw new Error("Subscription is not scheduled to cancel");

  const updated = await prisma.membershipSubscription.update({
    where: { id: subscriptionId },
    data: {
      status: "ACTIVE",
      cancelScheduledFor: null,
      cancellationReason: null,
      cancellationNotes: null,
      endDate: null,
    },
  });

  void audit({
    organizationId: sub.member.organizationId,
    actorId,
    action: "membership.cancel-undo",
    entityType: "MembershipSubscription",
    entityId: subscriptionId,
    before: { status: "CANCEL_SCHEDULED" },
    after: { status: "ACTIVE" },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Freeze
// ---------------------------------------------------------------------------

export type FreezeInput = {
  subscriptionId: string;
  immediate?: boolean;
  startDate?: Date;
  resumeDate: Date;
  feeCents?: number;
  reason: string;
};

export async function freezeSubscription(input: FreezeInput, actorId?: string) {
  const prisma = getPrisma();
  const sub = await prisma.membershipSubscription.findUnique({
    where: { id: input.subscriptionId },
    include: { member: true },
  });
  if (!sub) throw new Error("Subscription not found");

  const start = input.immediate ? new Date() : input.startDate ?? sub.paidThroughDate ?? new Date();
  const updated = await prisma.membershipSubscription.update({
    where: { id: input.subscriptionId },
    data: {
      status: input.immediate ? "FROZEN" : "FREEZE_SCHEDULED",
      freezeStartDate: start,
      freezeResumeDate: input.resumeDate,
      freezeReason: input.reason,
      freezeFeeCents: input.feeCents ?? 0,
    },
  });

  void audit({
    organizationId: sub.member.organizationId,
    actorId,
    action: input.immediate ? "membership.freeze-immediate" : "membership.freeze",
    entityType: "MembershipSubscription",
    entityId: input.subscriptionId,
    before: { status: sub.status },
    after: { status: updated.status, freezeStartDate: start, freezeResumeDate: input.resumeDate },
    metadata: { reason: input.reason, feeCents: input.feeCents },
  });

  if (input.immediate) {
    const desired = await computeDesiredAccessState(sub.memberId);
    void applyAccessState(sub.memberId, desired);
  }

  return updated;
}

export async function unfreezeSubscription(subscriptionId: string, actorId?: string) {
  const prisma = getPrisma();
  const sub = await prisma.membershipSubscription.findUnique({
    where: { id: subscriptionId },
    include: { member: true },
  });
  if (!sub) throw new Error("Subscription not found");

  const updated = await prisma.membershipSubscription.update({
    where: { id: subscriptionId },
    data: {
      status: "ACTIVE",
      freezeStartDate: null,
      freezeResumeDate: null,
      freezeReason: null,
    },
  });

  void audit({
    organizationId: sub.member.organizationId,
    actorId,
    action: "membership.unfreeze",
    entityType: "MembershipSubscription",
    entityId: subscriptionId,
    before: { status: sub.status },
    after: { status: "ACTIVE" },
  });

  const desired = await computeDesiredAccessState(sub.memberId);
  void applyAccessState(sub.memberId, desired);

  return updated;
}

// ---------------------------------------------------------------------------
// Extend
// ---------------------------------------------------------------------------

export async function extendSubscription(
  subscriptionId: string,
  days: number,
  actorId?: string,
  options?: { chargeCents?: number; reason?: string }
) {
  const prisma = getPrisma();
  const sub = await prisma.membershipSubscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) throw new Error("Subscription not found");

  const base = sub.paidThroughDate ?? sub.startDate;
  const next = new Date(base);
  next.setDate(next.getDate() + days);

  const updated = await prisma.membershipSubscription.update({
    where: { id: subscriptionId },
    data: { paidThroughDate: next },
  });

  void audit({
    actorId,
    action: "membership.extend",
    entityType: "MembershipSubscription",
    entityId: subscriptionId,
    before: { paidThroughDate: sub.paidThroughDate },
    after: { paidThroughDate: next },
    metadata: { days, chargeCents: options?.chargeCents, reason: options?.reason },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Plan change (mid-cycle, with proration)
// ---------------------------------------------------------------------------

export function computeProrationCents(opts: {
  currentPriceCents: number;
  newPriceCents: number;
  periodStart: Date;
  periodEnd: Date;
  changeDate: Date;
}): { remainingDays: number; totalDays: number; deltaCents: number } {
  const totalDays = Math.max(
    1,
    Math.round((opts.periodEnd.getTime() - opts.periodStart.getTime()) / 86_400_000)
  );
  const remainingDays = Math.max(
    0,
    Math.round((opts.periodEnd.getTime() - opts.changeDate.getTime()) / 86_400_000)
  );
  const dailyDelta = (opts.newPriceCents - opts.currentPriceCents) / totalDays;
  const deltaCents = Math.round(dailyDelta * remainingDays);
  return { remainingDays, totalDays, deltaCents };
}

export async function changePlan(opts: {
  subscriptionId: string;
  newPlanId: string;
  proration: "RETROACTIVE" | "PROSPECTIVE" | "NONE";
  /** Guests on the new plan; defaults to the current count (capped by the new plan). */
  guestCount?: number;
  /** Explicit per-period price (incl. guests) — otherwise plan price + guest add-on. */
  priceOverrideCents?: number;
  actorId?: string;
}) {
  const prisma = getPrisma();
  const sub = await prisma.membershipSubscription.findUnique({
    where: { id: opts.subscriptionId },
    include: { plan: true, member: true },
  });
  if (!sub) throw new Error("Subscription not found");

  const newPlan = await prisma.membershipPlan.findUnique({ where: { id: opts.newPlanId } });
  if (!newPlan) throw new Error("New plan not found");

  const guestCount = Math.max(0, Math.min(Math.floor(opts.guestCount ?? sub.guestCount), maxGuestsFor(newPlan)));
  const guestCents = guestCentsFor(newPlan, guestCount);
  const newPriceCents = opts.priceOverrideCents != null ? Math.max(0, Math.round(opts.priceOverrideCents)) : newPlan.priceCents + guestCents;

  let prorationCents = 0;
  if (opts.proration !== "NONE" && sub.paidThroughDate) {
    const r = computeProrationCents({
      currentPriceCents: sub.priceCents,
      newPriceCents,
      periodStart: sub.startDate,
      periodEnd: sub.paidThroughDate,
      changeDate: new Date(),
    });
    prorationCents = r.deltaCents;
  }

  const updated = await prisma.membershipSubscription.update({
    where: { id: opts.subscriptionId },
    data: {
      planId: newPlan.id,
      priceCents: newPriceCents,
      billingCadence: newPlan.billingCadence,
      guestCount,
      guestCents,
    },
  });
  await prisma.member.update({ where: { id: sub.memberId }, data: { membershipType: membershipDisplayName(newPlan.name, guestCount, newPlan.productType) } }).catch(() => undefined);

  void audit({
    organizationId: sub.member.organizationId,
    actorId: opts.actorId,
    action: "membership.plan-change",
    entityType: "MembershipSubscription",
    entityId: opts.subscriptionId,
    before: { planId: sub.planId, priceCents: sub.priceCents, guestCount: sub.guestCount },
    after: { planId: newPlan.id, priceCents: newPriceCents, guestCount },
    metadata: { proration: opts.proration, prorationCents },
  });

  const desired = await computeDesiredAccessState(sub.memberId);
  void applyAccessState(sub.memberId, desired);

  return { subscription: updated, prorationCents };
}

// ---------------------------------------------------------------------------
// Edit (guests / price / auto-renew / commitment)
// ---------------------------------------------------------------------------

export type EditSubscriptionInput = {
  subscriptionId: string;
  guestCount?: number;
  /** Per-period price including guests. Omit to recompute as plan price + guest add-on when guests change. */
  priceCents?: number | null;
  autoRenew?: boolean;
  /** Clear the promotional minimum term (waives any future early-cancellation fee). */
  clearCommitment?: boolean;
};

export async function editSubscription(input: EditSubscriptionInput, actorId?: string) {
  const prisma = getPrisma();
  const sub = await prisma.membershipSubscription.findUnique({ where: { id: input.subscriptionId }, include: { plan: true, member: true } });
  if (!sub) throw new Error("Subscription not found");

  const data: Parameters<typeof prisma.membershipSubscription.update>[0]["data"] = {};
  let guestCount = sub.guestCount;
  if (input.guestCount !== undefined) {
    const max = maxGuestsFor(sub.plan);
    guestCount = Math.max(0, Math.floor(input.guestCount));
    if (guestCount > max) throw new Error(`${sub.plan.name} allows up to ${max} guest${max === 1 ? "" : "s"}`);
    const guestCents = guestCentsFor(sub.plan, guestCount);
    data.guestCount = guestCount;
    data.guestCents = guestCents;
    // Keep the member's base price (which may be legacy / discounted) and swap the guest portion.
    if (input.priceCents == null) data.priceCents = Math.max(0, sub.priceCents - sub.guestCents + guestCents);
  }
  if (input.priceCents != null) {
    if (!Number.isFinite(input.priceCents) || input.priceCents < 0) throw new Error("Price must be zero or more");
    data.priceCents = Math.round(input.priceCents);
  }
  if (input.autoRenew !== undefined) data.autoRenew = !!input.autoRenew;
  if (input.clearCommitment) {
    data.commitmentMonths = null;
    data.commitmentEndsAt = null;
    data.earlyCancelFeeCents = null;
  }
  if (Object.keys(data).length === 0) return sub;

  const updated = await prisma.membershipSubscription.update({ where: { id: input.subscriptionId }, data });
  if (input.guestCount !== undefined) {
    await prisma.member.update({ where: { id: sub.memberId }, data: { membershipType: membershipDisplayName(sub.plan.name, guestCount, sub.plan.productType) } }).catch(() => undefined);
  }
  void audit({
    organizationId: sub.member.organizationId,
    actorId,
    action: "membership.edit",
    entityType: "MembershipSubscription",
    entityId: sub.id,
    before: { priceCents: sub.priceCents, guestCount: sub.guestCount, guestCents: sub.guestCents, autoRenew: sub.autoRenew, commitmentEndsAt: sub.commitmentEndsAt },
    after: { priceCents: updated.priceCents, guestCount: updated.guestCount, guestCents: updated.guestCents, autoRenew: updated.autoRenew, commitmentEndsAt: updated.commitmentEndsAt },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Background helpers (cron)
// ---------------------------------------------------------------------------

export async function applyScheduledCancellations(now = new Date()) {
  const prisma = getPrisma();
  const due = await prisma.membershipSubscription.findMany({
    where: { status: "CANCEL_SCHEDULED", cancelScheduledFor: { lte: now } },
  });
  for (const s of due) {
    await prisma.membershipSubscription.update({
      where: { id: s.id },
      data: { status: "CANCELLED", cancelledAt: now, endDate: now, autoRenew: false },
    });
    if (await noOtherLiveSubscriptions(s.memberId, s.id)) {
      await prisma.member.update({ where: { id: s.memberId }, data: { status: "CANCELLED" } }).catch(() => undefined);
    }
    const desired = await computeDesiredAccessState(s.memberId);
    void applyAccessState(s.memberId, desired);
    const plan = await prisma.membershipPlan.findUnique({ where: { id: s.planId }, select: { name: true, productType: true } });
    void emitMemberEvent("membership.cancelled", {
      memberId: s.memberId,
      locationId: s.locationId,
      refs: { subscriptionId: s.id },
      vars: { planName: plan ? membershipDisplayName(plan.name, s.guestCount, plan.productType) : undefined, reason: s.cancellationReason ?? undefined, dueDate: now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) },
    });
  }
  return due.length;
}

export async function applyScheduledFreezeTransitions(now = new Date()) {
  const prisma = getPrisma();
  const startNow = await prisma.membershipSubscription.findMany({
    where: { status: "FREEZE_SCHEDULED", freezeStartDate: { lte: now } },
  });
  for (const s of startNow) {
    await prisma.membershipSubscription.update({ where: { id: s.id }, data: { status: "FROZEN" } });
    await prisma.member.update({ where: { id: s.memberId, status: "ACTIVE" }, data: { status: "FROZEN" } }).catch(() => undefined);
    const desired = await computeDesiredAccessState(s.memberId);
    void applyAccessState(s.memberId, desired);
    void emitMemberEvent("membership.frozen", {
      memberId: s.memberId,
      locationId: s.locationId,
      refs: { subscriptionId: s.id },
      vars: { dueDate: s.freezeResumeDate ? s.freezeResumeDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "", reason: s.freezeReason ?? undefined },
    });
  }

  const resumeNow = await prisma.membershipSubscription.findMany({
    where: { status: "FROZEN", freezeResumeDate: { lte: now } },
  });
  for (const s of resumeNow) {
    await prisma.membershipSubscription.update({
      where: { id: s.id },
      data: { status: "ACTIVE", freezeStartDate: null, freezeResumeDate: null, autoRenew: true, ...(s.nextInvoiceDate && s.nextInvoiceDate < now ? { nextInvoiceDate: now } : {}) },
    });
    await prisma.member.update({ where: { id: s.memberId, status: "FROZEN" }, data: { status: "ACTIVE" } }).catch(() => undefined);
    const desired = await computeDesiredAccessState(s.memberId);
    void applyAccessState(s.memberId, desired);
    void emitMemberEvent("membership.resumed", { memberId: s.memberId, locationId: s.locationId, refs: { subscriptionId: s.id } });
  }

  return { started: startNow.length, resumed: resumeNow.length };
}

export type SubscriptionWithPlan = MembershipSubscription & { plan: MembershipPlan };
