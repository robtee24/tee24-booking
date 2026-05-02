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
import { squareCancelSubscription } from "@/lib/square";
import type { MembershipSubscription, MembershipPlan } from "@prisma/client";

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
};

export async function cancelSubscription(input: CancelInput, actorId?: string) {
  const prisma = getPrisma();
  const sub = await prisma.membershipSubscription.findUnique({
    where: { id: input.subscriptionId },
    include: { member: true, plan: true },
  });
  if (!sub) throw new Error("Subscription not found");

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
    },
  });

  if (sub.squareSubscriptionId) {
    squareCancelSubscription(sub.squareSubscriptionId).catch((err) =>
      console.warn("[membership.cancel] Square sync failed; will be retried", err)
    );
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
    const desired = await computeDesiredAccessState(sub.memberId);
    void applyAccessState(sub.memberId, desired);
  }

  return updated;
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

  let prorationCents = 0;
  if (opts.proration !== "NONE" && sub.paidThroughDate) {
    const r = computeProrationCents({
      currentPriceCents: sub.priceCents,
      newPriceCents: newPlan.priceCents,
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
      priceCents: newPlan.priceCents,
      billingCadence: newPlan.billingCadence,
    },
  });

  void audit({
    organizationId: sub.member.organizationId,
    actorId: opts.actorId,
    action: "membership.plan-change",
    entityType: "MembershipSubscription",
    entityId: opts.subscriptionId,
    before: { planId: sub.planId, priceCents: sub.priceCents },
    after: { planId: newPlan.id, priceCents: newPlan.priceCents },
    metadata: { proration: opts.proration, prorationCents },
  });

  const desired = await computeDesiredAccessState(sub.memberId);
  void applyAccessState(sub.memberId, desired);

  return { subscription: updated, prorationCents };
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
      data: { status: "CANCELLED", cancelledAt: now, endDate: now },
    });
    const desired = await computeDesiredAccessState(s.memberId);
    void applyAccessState(s.memberId, desired);
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
    const desired = await computeDesiredAccessState(s.memberId);
    void applyAccessState(s.memberId, desired);
  }

  const resumeNow = await prisma.membershipSubscription.findMany({
    where: { status: "FROZEN", freezeResumeDate: { lte: now } },
  });
  for (const s of resumeNow) {
    await prisma.membershipSubscription.update({
      where: { id: s.id },
      data: { status: "ACTIVE", freezeStartDate: null, freezeResumeDate: null },
    });
    const desired = await computeDesiredAccessState(s.memberId);
    void applyAccessState(s.memberId, desired);
  }

  return { started: startNow.length, resumed: resumeNow.length };
}

export type SubscriptionWithPlan = MembershipSubscription & { plan: MembershipPlan };
