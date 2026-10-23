/**
 * Recurring billing — turns ACTIVE subscriptions into invoices on their
 * `nextInvoiceDate` and attempts to collect with the member's default card.
 *
 * Runs from the `generate-invoices` cron (daily 09:00 UTC) and can be invoked
 * for a single subscription (e.g. right after creating an ad-hoc recurring charge).
 *
 * Idempotency: at most one invoice per (subscription, scheduledFor) — we
 * check for an existing invoice on the same billing date before creating.
 *
 * Ad-hoc recurring charges ("Recurring → New recurring charge") are modelled
 * as a MembershipSubscription on a hidden plan: a MembershipPlan row with
 * `archived = true`, `productType = "RECURRING"`, `allowedLocations = <locationId>`
 * and `description = "Ad-hoc recurring charge"`. Archived plans don't appear in
 * the plan catalog / signup forms, but subscriptions on them bill exactly like
 * a membership — no new schema needed.
 */
import { getPrisma } from "@/lib/db";
import { guestLineLabel, membershipDisplayName } from "@/lib/membership-pricing";
import { audit } from "@/lib/audit";
import { isSquareConfigured } from "@/lib/square";
import {
  chargeInvoiceWithDefaultCard,
  computeInvoiceMath,
  createInvoice,
} from "./billing.service";
import { computeDiscountCents, findRecurringDiscountForMember } from "./discount.service";
import { applyPendingChangeIfDue } from "./portal-membership.service";
import type { Prisma } from "@prisma/client";

export const AD_HOC_PLAN_DESCRIPTION = "Ad-hoc recurring charge";

export type Cadence = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "ANNUAL" | "ONE_OFF";

export function normalizeCadence(c: string | null | undefined): Cadence {
  const u = (c ?? "MONTHLY").toUpperCase();
  if (u === "ANNUAL" || u === "ANNUALLY" || u === "YEARLY") return "YEARLY";
  if (u === "WEEKLY" || u === "QUARTERLY" || u === "ONE_OFF" || u === "MONTHLY") return u as Cadence;
  return "MONTHLY";
}

export function isRecurringCadence(c: string | null | undefined): boolean {
  return normalizeCadence(c) !== "ONE_OFF";
}

/** Add one billing period to a date (UTC-safe, clamps month overflow like 31 Jan → 28/29 Feb). */
export function advanceByCadence(date: Date, cadence: string | null | undefined): Date {
  const c = normalizeCadence(cadence);
  const d = new Date(date);
  if (c === "WEEKLY") {
    d.setUTCDate(d.getUTCDate() + 7);
    return d;
  }
  if (c === "ONE_OFF") {
    d.setUTCDate(d.getUTCDate() + 30);
    return d;
  }
  const months = c === "MONTHLY" ? 1 : c === "QUARTERLY" ? 3 : 12;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export function cadenceLabel(c: string | null | undefined): string {
  switch (normalizeCadence(c)) {
    case "WEEKLY": return "week";
    case "QUARTERLY": return "quarter";
    case "YEARLY": return "year";
    case "ONE_OFF": return "one-off";
    default: return "month";
  }
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function sameUtcDay(a: Date, b: Date): boolean {
  return startOfUtcDay(a).getTime() === startOfUtcDay(b).getTime();
}

function periodLabel(start: Date, cadence: string): string {
  const end = advanceByCadence(start, cadence);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(new Date(end.getTime() - 86_400_000))}`;
}

type SubForBilling = Prisma.MembershipSubscriptionGetPayload<{
  include: { plan: true; member: { select: { id: true; organizationId: true; status: true } }; location: true };
}>;

/**
 * Work out when the next invoice should be issued for a subscription that has
 * no `nextInvoiceDate` yet (legacy / imported rows). Never bills retroactively:
 * if the computed date is in the past we roll forward to the first date ≥ today.
 */
export function computeBackfilledNextInvoiceDate(sub: Pick<SubForBilling, "startDate" | "paidThroughDate" | "billingCadence">, now = new Date()): Date {
  const today = startOfUtcDay(now);
  let next = sub.paidThroughDate ? startOfUtcDay(sub.paidThroughDate) : advanceByCadence(startOfUtcDay(sub.startDate), sub.billingCadence);
  let guard = 0;
  while (next < today && guard++ < 600) next = advanceByCadence(next, sub.billingCadence);
  return next;
}

export type GenerateResult = {
  scanned: number;
  backfilled: number;
  created: string[];
  charged: string[];
  failed: Array<{ invoiceId: string; reason: string }>;
  skipped: Array<{ subscriptionId: string; reason: string }>;
};

/**
 * One-off plans (day passes, punch cards, prepaid blocks) never renew, so once
 * their paid-through date passes the subscription lapses and door access is
 * recomputed. Runs with the invoice generator.
 */
export async function expireLapsedOneOffSubscriptions(now = new Date()): Promise<{ expired: string[] }> {
  const prisma = getPrisma();
  const subs = await prisma.membershipSubscription.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ autoRenew: false }, { billingCadence: "ONE_OFF" }, { plan: { productType: { in: ["DAY_PASS", "ONE_OFF", "PUNCH_CARD"] } } }],
      paidThroughDate: { lt: now },
    },
    select: { id: true, memberId: true, paidThroughDate: true, plan: { select: { productType: true, billingCadence: true } } },
    take: 500,
  });
  const expired: string[] = [];
  const { applyAccessState, computeDesiredAccessState } = await import("@/lib/access-sync");
  for (const sub of subs) {
    if (isRecurringCadence(sub.plan.billingCadence) && sub.plan.productType === "RECURRING") continue; // real memberships are handled by invoicing
    await prisma.membershipSubscription.update({ where: { id: sub.id }, data: { status: "CANCELLED", cancelledAt: now, endDate: sub.paidThroughDate ?? now, autoRenew: false } });
    expired.push(sub.id);
    void audit({ action: "membership.cancel-immediate", entityType: "MembershipSubscription", entityId: sub.id, metadata: { reason: "one-off plan lapsed", paidThroughDate: sub.paidThroughDate } });
    const desired = await computeDesiredAccessState(sub.memberId);
    void applyAccessState(sub.memberId, desired);
  }
  return { expired };
}

/** Generate + attempt to collect every invoice that is due as of `now`. */
export async function generateDueInvoices(now = new Date(), opts?: { subscriptionId?: string; actorId?: string }): Promise<GenerateResult> {
  const prisma = getPrisma();
  const result: GenerateResult = { scanned: 0, backfilled: 0, created: [], charged: [], failed: [], skipped: [] };

  const subs = await prisma.membershipSubscription.findMany({
    where: {
      status: "ACTIVE",
      autoRenew: true,
      ...(opts?.subscriptionId ? { id: opts.subscriptionId } : {}),
      OR: [{ nextInvoiceDate: null }, { nextInvoiceDate: { lte: now } }],
    },
    include: { plan: true, member: { select: { id: true, organizationId: true, status: true } }, location: true },
    orderBy: { nextInvoiceDate: "asc" },
    take: 500,
  });

  for (const sub of subs) {
    result.scanned++;
    if (!isRecurringCadence(sub.billingCadence) || sub.plan.productType === "DAY_PASS" || sub.plan.productType === "COMP") {
      result.skipped.push({ subscriptionId: sub.id, reason: "non-recurring plan" });
      continue;
    }
    if (sub.priceCents <= 0) {
      // Free plans: keep the schedule moving but never invoice.
      const next = advanceByCadence(sub.nextInvoiceDate ?? computeBackfilledNextInvoiceDate(sub, now), sub.billingCadence);
      await prisma.membershipSubscription.update({ where: { id: sub.id }, data: { nextInvoiceDate: next, paidThroughDate: next } });
      result.skipped.push({ subscriptionId: sub.id, reason: "zero price" });
      continue;
    }

    let billingDate = sub.nextInvoiceDate;
    if (!billingDate) {
      billingDate = computeBackfilledNextInvoiceDate(sub, now);
      await prisma.membershipSubscription.update({ where: { id: sub.id }, data: { nextInvoiceDate: billingDate } });
      result.backfilled++;
      if (billingDate > now) {
        result.skipped.push({ subscriptionId: sub.id, reason: `backfilled nextInvoiceDate → ${billingDate.toISOString().slice(0, 10)}` });
        continue;
      }
    }

    try {
      // Self-service downgrade scheduled for this renewal? Apply it first so the invoice reflects the new plan.
      let billable = sub;
      if (sub.pendingChangeAt && sub.pendingChangeAt <= billingDate) {
        const applied = await applyPendingChangeIfDue(sub.id, billingDate);
        if (applied) {
          const fresh = await prisma.membershipSubscription.findUnique({ where: { id: sub.id }, include: { plan: true, member: { select: { id: true, organizationId: true, status: true } }, location: true } });
          if (fresh) billable = fresh;
        }
      }
      const r = await issueInvoiceForSubscription(billable, billingDate, { actorId: opts?.actorId, now });
      if (r.invoiceId) result.created.push(r.invoiceId);
      if (r.charged) result.charged.push(r.invoiceId!);
      if (r.failureReason && r.invoiceId) result.failed.push({ invoiceId: r.invoiceId, reason: r.failureReason });
      if (r.skippedReason) result.skipped.push({ subscriptionId: sub.id, reason: r.skippedReason });
    } catch (e: unknown) {
      result.skipped.push({ subscriptionId: sub.id, reason: e instanceof Error ? e.message : String(e) });
      console.error("[recurring] failed for subscription", sub.id, e);
    }
  }

  return result;
}

/**
 * Issue the invoice for one billing date, advance `nextInvoiceDate`, and try
 * to collect. Safe to call twice for the same date (second call is a no-op).
 */
export async function issueInvoiceForSubscription(
  sub: SubForBilling,
  billingDate: Date,
  opts: { actorId?: string; now?: Date; attemptCharge?: boolean } = {},
): Promise<{ invoiceId: string | null; charged: boolean; failureReason: string | null; skippedReason?: string }> {
  const prisma = getPrisma();
  const now = opts.now ?? new Date();
  const dayStart = startOfUtcDay(billingDate);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  // Idempotency — one invoice per subscription per billing date
  const existing = await prisma.invoice.findFirst({
    where: { subscriptionId: sub.id, OR: [{ scheduledFor: { gte: dayStart, lt: dayEnd } }, { scheduledFor: null, dueDate: { gte: dayStart, lt: dayEnd } }] },
    select: { id: true, status: true },
  });
  const nextDate = advanceByCadence(dayStart, sub.billingCadence);
  if (existing) {
    if (sub.nextInvoiceDate && sameUtcDay(sub.nextInvoiceDate, dayStart)) {
      await prisma.membershipSubscription.update({ where: { id: sub.id }, data: { nextInvoiceDate: nextDate } });
    }
    return { invoiceId: existing.id, charged: false, failureReason: null, skippedReason: "invoice already exists for this period" };
  }

  const squareReady = await isSquareConfigured(sub.locationId);
  const defaultCard = squareReady
    ? await prisma.paymentMethod.findFirst({ where: { memberId: sub.memberId, status: { not: "EXPIRED" }, squareCardId: { not: null } }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] })
    : null;

  const discount = await findRecurringDiscountForMember(sub.memberId, sub.planId);
  const discountCents = discount ? computeDiscountCents(discount, sub.priceCents) : 0;

  const invoice = await createInvoice(
    {
      organizationId: sub.member.organizationId,
      locationId: sub.locationId,
      memberId: sub.memberId,
      subscriptionId: sub.id,
      description: `${membershipDisplayName(sub.plan.name, sub.guestCount, sub.plan.productType)} — ${periodLabel(dayStart, sub.billingCadence)}`,
      dueDate: dayStart,
      scheduledFor: dayStart,
      discountCents,
      taxRateBps: sub.location.taxRateBps,
      surchargeBps: sub.location.cardSurchargeBps,
      applySurcharge: Boolean(defaultCard) && sub.location.cardSurchargeBps > 0,
      lines:
        sub.guestCount > 0 && sub.guestCents > 0 && sub.guestCents < sub.priceCents
          ? [
              { description: sub.plan.name, unitCents: sub.priceCents - sub.guestCents },
              { description: `Guest add-on — ${guestLineLabel(sub.guestCount, sub.plan.productType)}`, unitCents: sub.guestCents },
            ]
          : [{ description: membershipDisplayName(sub.plan.name, sub.guestCount, sub.plan.productType), unitCents: sub.priceCents }],
    },
    opts.actorId,
  );
  if (discount && discountCents > 0) {
    await prisma.discountApplication.create({ data: { discountId: discount.id, memberId: sub.memberId, invoiceId: invoice.id, amountCents: discountCents } });
  }

  await prisma.membershipSubscription.update({ where: { id: sub.id }, data: { nextInvoiceDate: nextDate } });

  void audit({
    organizationId: sub.member.organizationId,
    actorId: opts.actorId,
    action: "billing.invoice-edit",
    entityType: "Invoice",
    entityId: invoice.id,
    metadata: { recurring: true, subscriptionId: sub.id, billingDate: dayStart.toISOString(), nextInvoiceDate: nextDate.toISOString() },
  });

  if (invoice.totalCents <= 0) {
    const { onInvoicePaid } = await import("./billing.service");
    await onInvoicePaid(invoice.id, { paidCents: 0, method: "COMP", receipt: false });
    return { invoiceId: invoice.id, charged: true, failureReason: null };
  }

  if ((opts.attemptCharge ?? true) && defaultCard && dayStart <= now) {
    try {
      await chargeInvoiceWithDefaultCard(invoice.id, opts.actorId);
      return { invoiceId: invoice.id, charged: true, failureReason: null };
    } catch (e: unknown) {
      return { invoiceId: invoice.id, charged: false, failureReason: e instanceof Error ? e.message : String(e) };
    }
  }
  return { invoiceId: invoice.id, charged: false, failureReason: null };
}

// ---------------------------------------------------------------------------
// Standalone / ad-hoc recurring charges
// ---------------------------------------------------------------------------

export async function createAdHocRecurringCharge(input: {
  locationId: string;
  memberId: string;
  name: string;
  amountCents: number;
  cadence: string;
  startDate: Date;
  actorId?: string;
}) {
  const prisma = getPrisma();
  if (!input.name.trim()) throw new Error("Name is required");
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) throw new Error("Amount must be positive");
  if (!isRecurringCadence(input.cadence)) throw new Error("Cadence must be recurring");

  const [member, location] = await Promise.all([
    prisma.member.findUnique({ where: { id: input.memberId }, select: { id: true, organizationId: true, locationId: true } }),
    prisma.location.findUnique({ where: { id: input.locationId } }),
  ]);
  if (!member) throw new Error("Member not found");
  if (!location) throw new Error("Location not found");

  const plan = await prisma.membershipPlan.create({
    data: {
      organizationId: location.organizationId,
      name: input.name.trim(),
      description: AD_HOC_PLAN_DESCRIPTION,
      productType: "RECURRING",
      category: "MEMBER",
      priceCents: Math.round(input.amountCents),
      signupFeeCents: 0,
      billingCadence: normalizeCadence(input.cadence),
      archived: true,
      allowedLocations: location.id,
    },
  });

  const start = startOfUtcDay(input.startDate);
  const sub = await prisma.membershipSubscription.create({
    data: {
      memberId: member.id,
      planId: plan.id,
      locationId: location.id,
      status: "ACTIVE",
      startDate: start,
      priceCents: plan.priceCents,
      signupFeeCents: 0,
      billingCadence: plan.billingCadence,
      nextInvoiceDate: start,
      autoRenew: true,
    },
  });

  void audit({
    organizationId: location.organizationId,
    actorId: input.actorId,
    action: "membership.create",
    entityType: "MembershipSubscription",
    entityId: sub.id,
    after: sub,
    metadata: { adHocRecurringCharge: true, planId: plan.id },
  });

  // Bill immediately if the first charge is due today or earlier
  let generated: GenerateResult | null = null;
  if (start <= new Date()) generated = await generateDueInvoices(new Date(), { subscriptionId: sub.id, actorId: input.actorId });
  return { subscription: sub, plan, generated };
}

export async function setSubscriptionAutoRenew(subscriptionId: string, autoRenew: boolean, actorId?: string) {
  const prisma = getPrisma();
  const before = await prisma.membershipSubscription.findUnique({ where: { id: subscriptionId } });
  if (!before) throw new Error("Subscription not found");
  const after = await prisma.membershipSubscription.update({
    where: { id: subscriptionId },
    data: { autoRenew, cancelRequestedAt: autoRenew ? null : before.cancelRequestedAt ?? new Date() },
  });
  void audit({
    actorId,
    action: "membership.extend",
    entityType: "MembershipSubscription",
    entityId: subscriptionId,
    before: { autoRenew: before.autoRenew },
    after: { autoRenew },
    metadata: { field: "autoRenew" },
  });
  return after;
}

export async function setNextInvoiceDate(subscriptionId: string, nextInvoiceDate: Date, actorId?: string) {
  const prisma = getPrisma();
  const before = await prisma.membershipSubscription.findUnique({ where: { id: subscriptionId } });
  if (!before) throw new Error("Subscription not found");
  const after = await prisma.membershipSubscription.update({ where: { id: subscriptionId }, data: { nextInvoiceDate: startOfUtcDay(nextInvoiceDate) } });
  void audit({
    actorId,
    action: "membership.extend",
    entityType: "MembershipSubscription",
    entityId: subscriptionId,
    before: { nextInvoiceDate: before.nextInvoiceDate },
    after: { nextInvoiceDate: after.nextInvoiceDate },
  });
  return after;
}

/** Preview the next invoice amount for a subscription (for the Recurring table). */
export async function previewNextInvoiceCents(sub: { memberId: string; planId: string; priceCents: number; locationTaxRateBps: number }) {
  const discount = await findRecurringDiscountForMember(sub.memberId, sub.planId);
  const discountCents = discount ? computeDiscountCents(discount, sub.priceCents) : 0;
  return computeInvoiceMath({ subtotalCents: sub.priceCents, discountCents, taxRateBps: sub.locationTaxRateBps }).totalCents;
}
