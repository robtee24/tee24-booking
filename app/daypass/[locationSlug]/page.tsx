/**
 * Public day-pass checkout. Single-step purchase, no account required.
 * Charges via Square (when configured); on success creates a Visitor record
 * and grants a 24-hour Kisi credential.
 */
import { notFound, redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import { getSquarePublicConfig } from "@/lib/square";
import { DayPassClient } from "./DayPassClient";

export const dynamic = "force-dynamic";

export default async function DayPassPage({
  params,
}: {
  params: Promise<{ locationSlug: string }>;
}) {
  const { locationSlug } = await params;
  const prisma = getPrisma();

  const location = await prisma.location.findUnique({
    where: { slug: locationSlug },
    select: { id: true, name: true, slug: true, organizationId: true, taxRateBps: true, cardSurchargeBps: true, currency: true },
  });
  if (!location) return notFound();

  // Day passes now go through the full signup form (photo, birthdate, verified mobile,
  // signed waiver) so pass holders are real members with app door access. Send them to
  // the location's membership form with The Gilmore preselected; fall back to the legacy
  // single-step checkout only if no form offers a day pass here.
  const forms = await prisma.signupForm.findMany({ where: { locationId: location.id, active: true }, select: { slug: true, allowedPlanIds: true }, orderBy: { createdAt: "asc" } });
  const dayPassPlans = await prisma.membershipPlan.findMany({ where: { productType: "DAY_PASS", category: "VISITOR", archived: false, kisiDoorGroups: { not: Prisma.DbNull } }, select: { id: true }, orderBy: [{ sortOrder: "asc" }, { priceCents: "desc" }] });
  const dayPassIds = new Set(dayPassPlans.map((p) => p.id));
  const target = forms.find((f) => ((f.allowedPlanIds as string[] | null) ?? []).some((id) => dayPassIds.has(id)));
  if (target) {
    const planId = ((target.allowedPlanIds as string[]) ?? []).find((id) => dayPassIds.has(id))!;
    redirect(`/signup/${encodeURIComponent(target.slug)}?plan=${encodeURIComponent(planId)}`);
  }

  // Day-pass plan = a MembershipPlan with productType=DAY_PASS, category=VISITOR
  const [dayPasses, overrides] = await Promise.all([
    prisma.membershipPlan.findMany({
      where: {
        productType: "DAY_PASS",
        category: "VISITOR",
        archived: false,
        OR: [
          { organizationId: location.organizationId },
          { organizationId: null },
        ],
      },
      orderBy: { priceCents: "asc" },
    }),
    prisma.membershipPricingOverride.findMany({ where: { locationId: location.id } }),
  ]);
  const overrideByPlan = new Map(overrides.map((o) => [o.planId, o.priceCents]));
  const square = await getSquarePublicConfig(location.id);

  return (
    <DayPassClient
      location={{
        id: location.id,
        name: location.name,
        slug: location.slug,
        organizationId: location.organizationId,
        taxRateBps: location.taxRateBps,
        cardSurchargeBps: square.configured ? location.cardSurchargeBps : 0,
        currency: location.currency,
      }}
      dayPasses={dayPasses.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        priceCents: overrideByPlan.get(p.id) ?? p.priceCents,
        durationDays: p.durationDays ?? 1,
      }))}
      square={square}
    />
  );
}
