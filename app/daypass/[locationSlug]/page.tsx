/**
 * Public day-pass checkout. Single-step purchase, no account required.
 * Charges via Square (when configured); on success creates a Visitor record
 * and grants a 24-hour Kisi credential.
 */
import { notFound } from "next/navigation";
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
  const square = getSquarePublicConfig();

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
