/**
 * Public day-pass checkout. Single-step purchase, no account required.
 * Charges via Square; on success creates a Visitor record and grants a
 * 24-hour Kisi credential.
 */
import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { DayPassClient } from "./DayPassClient";

export default async function DayPassPage({
  params,
}: {
  params: Promise<{ locationSlug: string }>;
}) {
  const { locationSlug } = await params;
  const prisma = getPrisma();

  const location = await prisma.location.findUnique({
    where: { slug: locationSlug },
    select: { id: true, name: true, slug: true, organizationId: true },
  });
  if (!location) return notFound();

  // Day-pass plan = a MembershipPlan with productType=DAY_PASS, category=VISITOR
  const dayPasses = await prisma.membershipPlan.findMany({
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
  });

  return (
    <DayPassClient
      location={location}
      dayPasses={dayPasses.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        durationDays: p.durationDays ?? 1,
      }))}
    />
  );
}
