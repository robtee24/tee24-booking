import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { emitMemberEvent } from "@/lib/events";
import { subscribeMember } from "@/services/membership.service";
import { updateMember } from "@/services/member.service";
import { apiError, parseDate, readJson, requireMemberApi } from "../../_shared";
import { guestCentsFor, maxGuestsFor, membershipDisplayName, promoTagLabel } from "@/lib/membership-pricing";

export const dynamic = "force-dynamic";

/** GET /api/admin/members/[id]/subscriptions — all subscriptions (current + past) + available plans */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  const prisma = getPrisma();
  const [subscriptions, plans] = await Promise.all([
    prisma.membershipSubscription.findMany({ where: { memberId: id }, include: { plan: true }, orderBy: { startDate: "desc" } }),
    prisma.membershipPlan.findMany({
      where: { archived: false, OR: [{ organizationId: g.location.organizationId }, { organizationId: null }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, priceCents: true, signupFeeCents: true, billingCadence: true, productType: true, category: true, durationDays: true, allowedLocations: true, guestAddonCents: true, maxGuests: true, dayPassGuestPricing: true },
    }),
  ]);
  const visible = plans.filter((p) => !p.allowedLocations || p.allowedLocations.split(",").map((s) => s.trim()).includes(g.location.id));
  // Attach the signup promo / standing discount (e.g. 25% military/senior) so the UI can tag it.
  const promoIds = [...new Set(subscriptions.map((s) => s.promoDiscountId).filter((x): x is string => !!x))];
  const promos = promoIds.length ? await prisma.discount.findMany({ where: { id: { in: promoIds } }, select: { id: true, code: true, name: true, type: true, value: true } }) : [];
  const promoById = new Map(promos.map((d) => [d.id, { id: d.id, code: d.code, name: d.name, label: promoTagLabel(d) }]));
  // Scheduled self-service downgrades: resolve the target plan name for display.
  const pendingIds = [...new Set(subscriptions.map((s) => s.pendingPlanId).filter((x): x is string => !!x))];
  const pendingPlans = pendingIds.length ? await prisma.membershipPlan.findMany({ where: { id: { in: pendingIds } }, select: { id: true, name: true, productType: true } }) : [];
  const pendingById = new Map(pendingPlans.map((p) => [p.id, p]));
  return NextResponse.json({
    subscriptions: subscriptions.map((s) => {
      const pp = s.pendingPlanId ? pendingById.get(s.pendingPlanId) : null;
      return {
        ...s,
        promo: (s.promoDiscountId && promoById.get(s.promoDiscountId)) || null,
        pendingChange: pp && s.pendingChangeAt && s.pendingGuestCount != null && s.pendingPriceCents != null
          ? { displayName: membershipDisplayName(pp.name, s.pendingGuestCount, pp.productType), priceCents: s.pendingPriceCents, effectiveAt: s.pendingChangeAt }
          : null,
      };
    }),
    plans: visible,
  });
}

/**
 * POST /api/admin/members/[id]/subscriptions
 * { planId, startDate?, priceOverrideCents?, comp?, activate?, guestCount? }
 * Permission membership.subscribe (membership.comp for comp).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    const body = await readJson(req);
    const comp = !!body.comp;
    assertCan(g.actor, comp ? "membership.comp" : "membership.subscribe", { locationId: g.member.locationId });
    if (!body.planId) return NextResponse.json({ error: "planId required" }, { status: 400 });

    const startDate = parseDate(body.startDate) ?? new Date();
    let sub = await subscribeMember({ memberId: id, planId: String(body.planId), locationId: g.member.locationId, startDate, comp }, g.admin.id);

    const patch: Prisma.MembershipSubscriptionUpdateInput = {};
    // Guests ("+ Guest" add-on): price = plan + guests unless an explicit override is given.
    const guestCount = body.guestCount === undefined || body.guestCount === null || body.guestCount === "" ? 0 : Number(body.guestCount);
    if (!Number.isInteger(guestCount) || guestCount < 0 || guestCount > maxGuestsFor(sub.plan)) return NextResponse.json({ error: `${sub.plan.name} allows up to ${maxGuestsFor(sub.plan)} guests` }, { status: 400 });
    const guestCents = guestCentsFor(sub.plan, guestCount);
    if (guestCount > 0) {
      patch.guestCount = guestCount;
      patch.guestCents = guestCents;
      patch.priceCents = comp ? 0 : sub.priceCents + guestCents;
    }
    if (body.priceOverrideCents != null && body.priceOverrideCents !== "") {
      const cents = Math.max(0, Math.round(Number(body.priceOverrideCents)));
      if (Number.isFinite(cents)) patch.priceCents = cents;
    }
    const displayName = membershipDisplayName(sub.plan.name, guestCount, sub.plan.productType);
    // Admin-created subscriptions are active immediately unless the caller asks for PENDING.
    if (!comp && body.activate !== false) {
      patch.status = "ACTIVE";
      if (sub.plan.durationDays) {
        const end = new Date(startDate);
        end.setDate(end.getDate() + sub.plan.durationDays);
        patch.paidThroughDate = end;
        patch.endDate = end;
      } else {
        const next = new Date(startDate);
        if (sub.billingCadence === "YEARLY") next.setFullYear(next.getFullYear() + 1);
        else if (sub.billingCadence === "WEEKLY") next.setDate(next.getDate() + 7);
        else next.setMonth(next.getMonth() + 1);
        patch.paidThroughDate = next;
        patch.nextInvoiceDate = next;
      }
    }
    if (Object.keys(patch).length) {
      sub = await getPrisma().membershipSubscription.update({ where: { id: sub.id }, data: patch, include: { plan: true } });
    }

    if ((sub.status === "ACTIVE" || sub.status === "COMP") && g.member.status !== "ACTIVE") {
      await updateMember(id, { status: "ACTIVE", membershipType: displayName }, g.admin.id);
    } else {
      await getPrisma().member.update({ where: { id }, data: { membershipType: displayName, membershipStartDate: startDate } });
    }

    void emitMemberEvent("membership.activated", {
      memberId: id,
      locationId: g.member.locationId,
      organizationId: g.member.organizationId,
      actorAdminId: g.admin.id,
      refs: { subscriptionId: sub.id },
      vars: { planName: displayName, priceCents: sub.priceCents, comp: comp ? "yes" : "no" },
    });

    return NextResponse.json({ ok: true, subscription: sub });
  } catch (e) {
    return apiError(e);
  }
}
