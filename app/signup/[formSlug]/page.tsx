import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { getSquarePublicConfig, publicConfigFromCreds } from "@/lib/square";
import { SignupClient } from "./SignupClient";
import { parseSignupFieldConfig, requiredSignupInputKeys } from "@/lib/signup-form-config";
import { sanitizeDocHtml } from "@/services/portal.service";

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
    include: { location: { select: { id: true, name: true, slug: true, organizationId: true, taxRateBps: true, cardSurchargeBps: true, currency: true } } },
  });

  if (!form || !form.active) notFound();

  // Resolve allowed plans (+ location price overrides)
  const allowedPlanIds = (form.allowedPlanIds as string[] | null) ?? null;
  const planWhere: Record<string, unknown> = { archived: false };
  if (allowedPlanIds && allowedPlanIds.length > 0) planWhere.id = { in: allowedPlanIds };

  const requiredDocIds = (form.requiredDocumentIds as string[] | null) ?? [];
  const [plans, overrides, customFieldDefs, documents] = await Promise.all([
    prisma.membershipPlan.findMany({ where: planWhere, orderBy: [{ productType: "asc" }, { priceCents: "asc" }] }),
    form.location ? prisma.membershipPricingOverride.findMany({ where: { locationId: form.location.id } }) : Promise.resolve([]),
    (() => {
      const ids = (form.customFieldIds as string[] | null) ?? [];
      return ids.length ? prisma.customFieldDefinition.findMany({ where: { id: { in: ids } }, orderBy: { sortOrder: "asc" } }) : Promise.resolve([]);
    })(),
    requiredDocIds.length
      ? prisma.document.findMany({ where: { id: { in: requiredDocIds }, active: true }, select: { id: true, name: true, description: true, bodyHtml: true, version: true } })
      : Promise.resolve([]),
  ]);
  const overrideByPlan = new Map(overrides.map((o) => [o.planId, o]));

  // UTM capture for downstream attribution
  const utm = {
    source: typeof sp.utm_source === "string" ? sp.utm_source : null,
    medium: typeof sp.utm_medium === "string" ? sp.utm_medium : null,
    campaign: typeof sp.utm_campaign === "string" ? sp.utm_campaign : null,
    term: typeof sp.utm_term === "string" ? sp.utm_term : null,
    content: typeof sp.utm_content === "string" ? sp.utm_content : null,
  };

  const referralCode = typeof sp.ref === "string" ? sp.ref : null;
  const square = form.location ? await getSquarePublicConfig(form.location.id) : publicConfigFromCreds(null);

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
        collectTax: form.collectTax,
        requiredFields: requiredSignupInputKeys(form.requiredFields, { photoRequired: form.photoRequired }),
        emergencyContactMode: parseSignupFieldConfig(form.requiredFields, { photoRequired: form.photoRequired }).emergencyContact,
        location: form.location
          ? {
              id: form.location.id,
              name: form.location.name,
              slug: form.location.slug,
              organizationId: form.location.organizationId,
              taxRateBps: form.location.taxRateBps,
              cardSurchargeBps: square.configured ? form.location.cardSurchargeBps : 0,
              currency: form.location.currency,
            }
          : null,
      }}
      plans={plans.map((p) => {
        const o = overrideByPlan.get(p.id);
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          priceCents: o?.priceCents ?? p.priceCents,
          signupFeeCents: o?.signupFeeCents ?? p.signupFeeCents,
          billingCadence: p.billingCadence,
          productType: p.productType,
          category: p.category,
          durationDays: p.durationDays,
        };
      })}
      documents={documents.map((d) => ({ id: d.id, name: d.name, description: d.description, bodyHtml: sanitizeDocHtml(d.bodyHtml ?? ""), version: d.version }))}
      customFields={customFieldDefs.map((d) => ({ id: d.id, name: d.name, type: d.type, required: d.required, options: (d.options as string[] | null) ?? null }))}
      utm={utm}
      referralCode={referralCode}
      square={square}
    />
  );
}
