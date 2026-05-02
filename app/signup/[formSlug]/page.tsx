import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { SignupClient } from "./SignupClient";

export const dynamic = "force-dynamic";

export default async function PublicSignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ formSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { formSlug } = await params;
  const sp = await searchParams;

  const prisma = getPrisma();
  const form = await prisma.signupForm.findUnique({
    where: { slug: formSlug },
    include: { location: { select: { id: true, name: true, slug: true, organizationId: true } } },
  });

  if (!form || !form.active) notFound();

  // Resolve allowed plans
  const allowedPlanIds = (form.allowedPlanIds as string[] | null) ?? null;
  const planWhere: any = { archived: false };
  if (allowedPlanIds && allowedPlanIds.length > 0) planWhere.id = { in: allowedPlanIds };

  const plans = await prisma.membershipPlan.findMany({
    where: planWhere,
    orderBy: { name: "asc" },
  });

  // UTM capture for downstream attribution
  const utm = {
    source: typeof sp.utm_source === "string" ? sp.utm_source : null,
    medium: typeof sp.utm_medium === "string" ? sp.utm_medium : null,
    campaign: typeof sp.utm_campaign === "string" ? sp.utm_campaign : null,
    term: typeof sp.utm_term === "string" ? sp.utm_term : null,
    content: typeof sp.utm_content === "string" ? sp.utm_content : null,
  };

  const referralCode = typeof sp.ref === "string" ? sp.ref : null;

  return (
    <SignupClient
      form={{
        id: form.id,
        slug: form.slug,
        name: form.name,
        description: form.description,
        defaultPlanId: form.defaultPlanId,
        allowDiscountCode: form.allowDiscountCode,
        photoRequired: form.photoRequired,
        authSetup: form.authSetup,
        location: form.location,
      }}
      plans={plans.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        signupFeeCents: p.signupFeeCents,
        billingCadence: p.billingCadence,
        productType: p.productType,
        category: p.category,
      }))}
      utm={utm}
      referralCode={referralCode}
    />
  );
}
