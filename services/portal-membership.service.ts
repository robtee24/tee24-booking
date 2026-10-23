/**
 * Member self-service plan & guest changes (clubhouse portal).
 *
 * Rules
 *  - Only an ACTIVE recurring subscription can be changed here. Frozen,
 *    pending, cancel-scheduled and day-pass holders go through the front desk.
 *  - Upgrades (new per-period price > current) take effect immediately: the
 *    prorated difference for the rest of the paid period is charged to the
 *    card on file right now. No card → the member is sent to add one first.
 *  - Downgrades (new price <= current) are scheduled: the member keeps what
 *    they paid for and the new plan/guest count applies at the next renewal.
 *    Recurring billing applies `pending*` just before issuing that invoice.
 *  - A standing discount is honoured either way: a recurring DiscountApplication
 *    marker (new signups) keeps priceCents gross and is applied per invoice; a
 *    legacy promo (promoDiscountId, no marker — migrated members) means
 *    priceCents is already net, so the promo percent is applied to the delta.
 *  - While MIGRATION_FREEZE is on (GymDesk still bills) nothing is charged or
 *    scheduled: callers fall back to the staff-request flow.
 */
import type { Discount, MembershipPlan, MembershipSubscription } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminNotify } from "@/lib/admin-notify";
import { emitMemberEvent } from "@/lib/events";
import { isMigrationFrozen } from "@/lib/migration-freeze";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";
import { addPeriods, guestCentsFor, maxGuestsFor, membershipDisplayName, promoTagLabel } from "@/lib/membership-pricing";
import { computeDiscountCents, findRecurringDiscountForMember } from "@/services/discount.service";
import { chargeInvoiceWithDefaultCard, createInvoice, writeOffInvoice } from "@/services/billing.service";
import { computeProrationCents } from "@/services/membership.service";
import { PortalError } from "@/services/portal.service";
import { adminRoutes } from "@/lib/admin/routes";

export type SelfServicePlan = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  billingCadence: string;
  guestAddonCents: number | null;
  maxGuests: number;
  /** Per-period price the member would pay for this plan with 0 guests, after their standing discount. */
  netPriceCents: number;
};

export type ChangePreview = {
  mode: "self-service" | "request";
  requestReason: string | null;
  current: { planId: string; planName: string; displayName: string; guestCount: number; netPriceCents: number; billingCadence: string };
  target: { planId: string; planName: string; displayName: string; guestCount: number; netPriceCents: number; billingCadence: string };
  kind: "upgrade" | "downgrade" | "none";
  deltaPerPeriodCents: number;
  /** Upgrade only: prorated amount charged today. */
  dueTodayCents: number;
  proration: { remainingDays: number; totalDays: number; periodEnd: string | null } | null;
  effectiveAt: string | null;
  hasCard: boolean;
  requiresCard: boolean;
  discount: { label: string; name: string } | null;
  pendingChange: PendingChangeView | null;
};

export type PendingChangeView = { planId: string; planName: string; displayName: string; guestCount: number; priceCents: number; effectiveAt: string };

const ACTIVE_FOR_CHANGE = new Set(["ACTIVE"]);

type SubWithPlan = MembershipSubscription & { plan: MembershipPlan };

async function loadSub(memberId: string): Promise<SubWithPlan | null> {
  return getPrisma().membershipSubscription.findFirst({
    where: { memberId, status: { in: ["ACTIVE", "CANCEL_SCHEDULED", "FROZEN", "COMP", "PENDING", "FREEZE_SCHEDULED"] } },
    include: { plan: true },
    orderBy: { startDate: "desc" },
  });
}

/** Plans a member may move between: the location's signup form allow-list, recurring only. */
export async function listSelfServicePlans(memberId: string): Promise<{ plans: SelfServicePlan[]; discount: Discount | null; legacyPromo: Discount | null }> {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { locationId: true, organizationId: true } });
  if (!member) throw new PortalError("Member not found", 404);
  const sub = await loadSub(memberId);

  const forms = await prisma.signupForm.findMany({ where: { locationId: member.locationId }, select: { allowedPlanIds: true } });
  const allowed = new Set<string>(forms.flatMap((f) => ((f.allowedPlanIds as string[] | null) ?? [])));
  if (sub) allowed.add(sub.planId);

  const where = allowed.size
    ? { id: { in: [...allowed] }, archived: false, productType: "RECURRING" }
    : { archived: false, productType: "RECURRING", category: "MEMBER", OR: [{ organizationId: member.organizationId }, { organizationId: null }] };
  const plans = await prisma.membershipPlan.findMany({ where, orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }] });
  const visible = plans.filter((p) => !p.allowedLocations || p.allowedLocations.split(",").map((s) => s.trim()).includes(member.locationId));

  const { discount, legacyPromo } = sub ? await standingDiscount(memberId, sub) : { discount: null, legacyPromo: null };
  return {
    plans: visible.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      priceCents: p.priceCents,
      billingCadence: p.billingCadence,
      guestAddonCents: p.guestAddonCents,
      maxGuests: maxGuestsFor(p),
      netPriceCents: netOf(p.priceCents, discount ?? legacyPromo),
    })),
    discount,
    legacyPromo,
  };
}

/** Recurring marker discount (gross priceCents) vs legacy promo (net priceCents). */
async function standingDiscount(memberId: string, sub: SubWithPlan): Promise<{ discount: Discount | null; legacyPromo: Discount | null }> {
  const prisma = getPrisma();
  const marker = await findRecurringDiscountForMember(memberId, sub.planId);
  if (marker) return { discount: marker, legacyPromo: null };
  if (!sub.promoDiscountId) return { discount: null, legacyPromo: null };
  const promo = await prisma.discount.findUnique({ where: { id: sub.promoDiscountId } });
  if (!promo || !promo.active || promo.scope !== "FOREVER") return { discount: null, legacyPromo: null };
  return { discount: null, legacyPromo: promo };
}

function netOf(grossCents: number, d: Discount | null): number {
  if (!d || grossCents <= 0) return Math.max(0, grossCents);
  return Math.max(0, grossCents - computeDiscountCents(d, grossCents));
}

/**
 * Work out what the subscription row would look like after the change.
 *  - storedPriceCents: what goes in MembershipSubscription.priceCents
 *  - netPriceCents: what the member actually pays per period
 */
function priceFor(sub: SubWithPlan, target: MembershipPlan, guestCount: number, discount: Discount | null, legacyPromo: Discount | null) {
  const guestCents = guestCentsFor(target, guestCount);
  if (discount) {
    // Gross stored; marker discounts each invoice.
    const gross = (target.id === sub.planId ? sub.priceCents - sub.guestCents : target.priceCents) + guestCents;
    return { storedPriceCents: gross, guestCents, netPriceCents: netOf(gross, discount), currentNetCents: netOf(sub.priceCents, discount) };
  }
  if (legacyPromo) {
    if (target.id === sub.planId) {
      // Keep the member's (already discounted) base; discount only the guest delta.
      const delta = guestCents - sub.guestCents;
      const net = Math.max(0, sub.priceCents + (delta >= 0 ? netOf(delta, legacyPromo) : -netOf(-delta, legacyPromo)));
      return { storedPriceCents: net, guestCents, netPriceCents: net, currentNetCents: sub.priceCents };
    }
    const net = netOf(target.priceCents + guestCents, legacyPromo);
    return { storedPriceCents: net, guestCents, netPriceCents: net, currentNetCents: sub.priceCents };
  }
  const base = target.id === sub.planId ? sub.priceCents - sub.guestCents : target.priceCents;
  const price = Math.max(0, base + guestCents);
  return { storedPriceCents: price, guestCents, netPriceCents: price, currentNetCents: sub.priceCents };
}

/** Current paid period: [periodEnd − 1 cadence, periodEnd]. */
function currentPeriod(sub: SubWithPlan, now: Date): { start: Date; end: Date } | null {
  const end = sub.paidThroughDate ?? sub.nextInvoiceDate;
  if (!end || end.getTime() <= now.getTime()) return null;
  const start = addPeriods(end, sub.billingCadence, -1);
  return { start, end };
}

function pendingView(sub: SubWithPlan, pendingPlan: MembershipPlan | null): PendingChangeView | null {
  if (!sub.pendingChangeAt || !sub.pendingPlanId || sub.pendingGuestCount == null || sub.pendingPriceCents == null) return null;
  const name = pendingPlan?.name ?? "New plan";
  return {
    planId: sub.pendingPlanId,
    planName: name,
    displayName: membershipDisplayName(name, sub.pendingGuestCount, pendingPlan?.productType),
    guestCount: sub.pendingGuestCount,
    priceCents: sub.pendingPriceCents,
    effectiveAt: sub.pendingChangeAt.toISOString(),
  };
}

export async function getPendingChange(memberId: string): Promise<PendingChangeView | null> {
  const sub = await loadSub(memberId);
  if (!sub?.pendingPlanId) return null;
  const plan = await getPrisma().membershipPlan.findUnique({ where: { id: sub.pendingPlanId } });
  return pendingView(sub, plan);
}

async function hasCardOnFile(memberId: string): Promise<boolean> {
  const pm = await getPrisma().paymentMethod.findFirst({ where: { memberId, status: { not: "EXPIRED" }, squareCardId: { not: null } }, select: { id: true } });
  return Boolean(pm);
}

export async function previewChange(memberId: string, input: { planId?: string | null; guestCount: number }, now = new Date()): Promise<ChangePreview> {
  const prisma = getPrisma();
  const sub = await loadSub(memberId);
  if (!sub) throw new PortalError("You don't have an active membership");
  const targetPlanId = input.planId || sub.planId;
  const target = await prisma.membershipPlan.findUnique({ where: { id: targetPlanId } });
  if (!target || target.archived) throw new PortalError("That plan isn't available");
  if (target.productType !== "RECURRING") throw new PortalError("Only monthly memberships can be changed here");
  const guestCount = Math.max(0, Math.floor(Number(input.guestCount) || 0));
  if (guestCount > maxGuestsFor(target)) throw new PortalError(`${target.name} allows up to ${maxGuestsFor(target)} guest${maxGuestsFor(target) === 1 ? "" : "s"}`);

  const { discount, legacyPromo } = await standingDiscount(memberId, sub);
  const price = priceFor(sub, target, guestCount, discount, legacyPromo);
  const delta = price.netPriceCents - price.currentNetCents;
  const kind: ChangePreview["kind"] = target.id === sub.planId && guestCount === sub.guestCount ? "none" : delta > 0 ? "upgrade" : "downgrade";

  let requestReason: string | null = null;
  if (isMigrationFrozen()) requestReason = "Online plan changes open soon — for now a team member will apply this for you.";
  else if (!ACTIVE_FOR_CHANGE.has(sub.status)) requestReason = sub.status === "FROZEN" ? "Your membership is frozen. Ask the front desk to resume it before changing plans." : sub.status === "CANCEL_SCHEDULED" ? "Your membership is set to end. Ask the front desk to undo the cancellation first." : sub.status === "PENDING" ? "Your first payment hasn't cleared yet." : "This membership can't be changed online.";
  else if (sub.plan.productType !== "RECURRING") requestReason = "Day passes can't be changed online.";

  const period = currentPeriod(sub, now);
  let dueTodayCents = 0;
  let proration: ChangePreview["proration"] = null;
  if (kind === "upgrade" && period) {
    const r = computeProrationCents({ currentPriceCents: price.currentNetCents, newPriceCents: price.netPriceCents, periodStart: period.start, periodEnd: period.end, changeDate: now });
    dueTodayCents = Math.max(0, r.deltaCents);
    proration = { remainingDays: r.remainingDays, totalDays: r.totalDays, periodEnd: period.end.toISOString() };
  }
  const effectiveAt = kind === "upgrade" ? now.toISOString() : kind === "downgrade" ? (sub.nextInvoiceDate ?? sub.paidThroughDate)?.toISOString() ?? null : null;
  const hasCard = await hasCardOnFile(memberId);
  const pendingPlan = sub.pendingPlanId ? await prisma.membershipPlan.findUnique({ where: { id: sub.pendingPlanId } }) : null;
  const d = discount ?? legacyPromo;

  return {
    mode: requestReason ? "request" : "self-service",
    requestReason,
    current: { planId: sub.planId, planName: sub.plan.name, displayName: membershipDisplayName(sub.plan.name, sub.guestCount, sub.plan.productType), guestCount: sub.guestCount, netPriceCents: price.currentNetCents, billingCadence: sub.billingCadence },
    target: { planId: target.id, planName: target.name, displayName: membershipDisplayName(target.name, guestCount, target.productType), guestCount, netPriceCents: price.netPriceCents, billingCadence: target.billingCadence },
    kind,
    deltaPerPeriodCents: delta,
    dueTodayCents,
    proration,
    effectiveAt,
    hasCard,
    requiresCard: kind === "upgrade" && dueTodayCents > 0,
    discount: d ? { label: promoTagLabel(d), name: d.name } : null,
    pendingChange: pendingView(sub, pendingPlan),
  };
}

export type ApplyResult =
  | { applied: "now"; displayName: string; chargedCents: number; invoiceId: string | null }
  | { applied: "scheduled"; displayName: string; effectiveAt: string };

/** Apply a previewed change. Throws PortalError with a member-friendly message on any problem. */
export async function applyChange(memberId: string, input: { planId?: string | null; guestCount: number }): Promise<ApplyResult> {
  const prisma = getPrisma();
  const now = new Date();
  const preview = await previewChange(memberId, input, now);
  if (preview.mode === "request") throw new PortalError(preview.requestReason ?? "This change needs a team member", 409);
  if (preview.kind === "none") throw new PortalError("That's already your current plan");

  const sub = (await loadSub(memberId))!;
  const target = (await prisma.membershipPlan.findUnique({ where: { id: preview.target.planId } }))!;
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, firstName: true, lastName: true, organizationId: true, locationId: true, location: { select: { slug: true } } } });
  if (!member) throw new PortalError("Member not found", 404);
  const { discount, legacyPromo } = await standingDiscount(memberId, sub);
  const price = priceFor(sub, target, preview.target.guestCount, discount, legacyPromo);
  const displayName = preview.target.displayName;
  const name = `${member.firstName} ${member.lastName}`.trim();

  if (preview.kind === "downgrade") {
    const effectiveAt = preview.effectiveAt ? new Date(preview.effectiveAt) : null;
    if (!effectiveAt) {
      // No renewal date on file: apply immediately (nothing to protect).
      await applySubscriptionChange(sub, target, preview.target.guestCount, price.storedPriceCents, price.guestCents, memberId);
      await notifyStaff(member, sub.id, `Plan change · ${name}`, `${name} switched from ${preview.current.displayName} to ${displayName} (${fmt(price.netPriceCents)}/${sub.billingCadence.toLowerCase()}) via the clubhouse.`);
      return { applied: "now", displayName, chargedCents: 0, invoiceId: null };
    }
    await prisma.membershipSubscription.update({
      where: { id: sub.id },
      data: { pendingPlanId: target.id, pendingGuestCount: preview.target.guestCount, pendingPriceCents: price.storedPriceCents, pendingChangeAt: effectiveAt },
    });
    void audit({ organizationId: member.organizationId, actorRole: "MEMBER", action: "membership.plan-change", entityType: "MembershipSubscription", entityId: sub.id, metadata: { via: "portal", memberId, scheduled: true, effectiveAt, planId: target.id, guestCount: preview.target.guestCount, priceCents: price.storedPriceCents } });
    await notifyStaff(member, sub.id, `Scheduled plan change · ${name}`, `${name} scheduled a change from ${preview.current.displayName} to ${displayName} (${fmt(price.netPriceCents)}/${sub.billingCadence.toLowerCase()}) effective ${effectiveAt.toLocaleDateString("en-US")} via the clubhouse.`);
    return { applied: "scheduled", displayName, effectiveAt: effectiveAt.toISOString() };
  }

  // Upgrade: collect the prorated difference first, then switch.
  let invoiceId: string | null = null;
  let charged = 0;
  if (preview.dueTodayCents > 0) {
    if (!preview.hasCard) throw new PortalError("Add a card to your account first, then try again.", 402);
    const inv = await createInvoice(
      {
        organizationId: member.organizationId,
        locationId: member.locationId,
        memberId,
        // Deliberately not linked to the subscription so paying it doesn't extend paidThroughDate.
        description: `Upgrade to ${displayName} — prorated for the rest of your current period`,
        dueDate: now,
        lines: [{ description: `Prorated upgrade: ${preview.current.displayName} → ${displayName} (${preview.proration?.remainingDays ?? 0} of ${preview.proration?.totalDays ?? 0} days)`, unitCents: preview.dueTodayCents }],
        adminNotes: "Self-service upgrade from the clubhouse portal.",
      },
      undefined,
    );
    invoiceId = inv.id;
    try {
      await chargeInvoiceWithDefaultCard(inv.id);
      charged = preview.dueTodayCents;
    } catch (err) {
      await writeOffInvoice(inv.id, { reason: "Self-service upgrade: card charge failed" }).catch(() => undefined);
      const msg = err instanceof Error ? err.message : "Card declined";
      throw new PortalError(`We couldn't charge your card on file (${msg}). Update your card and try again.`, 402);
    }
  }

  await applySubscriptionChange(sub, target, preview.target.guestCount, price.storedPriceCents, price.guestCents, memberId);

  void emitMemberEvent("membership.renewed", {
    memberId,
    locationId: member.locationId,
    organizationId: member.organizationId,
    refs: { subscriptionId: sub.id, invoiceId: invoiceId ?? undefined },
    vars: { planName: displayName, previousPlanName: preview.current.displayName, prorationCents: charged, planChange: "yes" },
  });
  await notifyStaff(member, sub.id, `Plan upgrade · ${name}`, `${name} upgraded from ${preview.current.displayName} to ${displayName} (${fmt(price.netPriceCents)}/${sub.billingCadence.toLowerCase()}) via the clubhouse${charged ? ` and paid ${fmt(charged)} prorated` : ""}.`);
  return { applied: "now", displayName, chargedCents: charged, invoiceId };
}

export async function cancelPendingChange(memberId: string) {
  const prisma = getPrisma();
  const sub = await loadSub(memberId);
  if (!sub?.pendingPlanId) throw new PortalError("There's no scheduled change to cancel");
  await prisma.membershipSubscription.update({ where: { id: sub.id }, data: { pendingPlanId: null, pendingGuestCount: null, pendingPriceCents: null, pendingChangeAt: null } });
  void audit({ actorRole: "MEMBER", action: "membership.plan-change", entityType: "MembershipSubscription", entityId: sub.id, metadata: { via: "portal", memberId, scheduledChangeCancelled: true } });
  return { ok: true };
}

async function applySubscriptionChange(sub: SubWithPlan, target: MembershipPlan, guestCount: number, priceCents: number, guestCents: number, memberId: string) {
  const prisma = getPrisma();
  await prisma.membershipSubscription.update({
    where: { id: sub.id },
    data: {
      planId: target.id,
      priceCents,
      guestCount,
      guestCents,
      billingCadence: target.billingCadence,
      pendingPlanId: null,
      pendingGuestCount: null,
      pendingPriceCents: null,
      pendingChangeAt: null,
    },
  });
  await prisma.member.update({ where: { id: sub.memberId }, data: { membershipType: membershipDisplayName(target.name, guestCount, target.productType) } }).catch(() => undefined);
  void audit({
    actorRole: "MEMBER",
    action: "membership.plan-change",
    entityType: "MembershipSubscription",
    entityId: sub.id,
    before: { planId: sub.planId, priceCents: sub.priceCents, guestCount: sub.guestCount },
    after: { planId: target.id, priceCents, guestCount },
    metadata: { via: "portal", memberId },
  });
  const desired = await computeDesiredAccessState(sub.memberId);
  void applyAccessState(sub.memberId, desired);
}

/**
 * Called by recurring billing before issuing a period's invoice. Applies the
 * scheduled downgrade when its effective date has arrived.
 */
export async function applyPendingChangeIfDue(subscriptionId: string, asOf: Date): Promise<boolean> {
  const prisma = getPrisma();
  const sub = await prisma.membershipSubscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } });
  if (!sub?.pendingPlanId || !sub.pendingChangeAt || sub.pendingGuestCount == null || sub.pendingPriceCents == null) return false;
  if (sub.pendingChangeAt.getTime() > asOf.getTime()) return false;
  const target = await prisma.membershipPlan.findUnique({ where: { id: sub.pendingPlanId } });
  if (!target) {
    await prisma.membershipSubscription.update({ where: { id: sub.id }, data: { pendingPlanId: null, pendingGuestCount: null, pendingPriceCents: null, pendingChangeAt: null } });
    return false;
  }
  await applySubscriptionChange(sub, target, sub.pendingGuestCount, sub.pendingPriceCents, guestCentsFor(target, sub.pendingGuestCount), sub.memberId);
  return true;
}

async function notifyStaff(member: { id: string; organizationId: string | null; locationId: string; location: { slug: string } | null }, subscriptionId: string, title: string, body: string) {
  await adminNotify({
    organizationId: member.organizationId ?? undefined,
    locationId: member.locationId,
    kind: "membership.plan-change",
    severity: "INFO",
    title,
    body,
    link: member.location ? adminRoutes.loc.members.detailTab(member.location.slug, member.id, "memberships") : undefined,
    data: { memberId: member.id, subscriptionId },
  }).catch(() => undefined);
}

const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
