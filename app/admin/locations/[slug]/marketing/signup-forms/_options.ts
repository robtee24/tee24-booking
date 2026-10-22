import { getPrisma } from "@/lib/db";
import type { SignupBuilderOptions, SignupFormDraft } from "@/components/admin/marketing/SignupFormBuilder";
import { parseIdList, parseSignupFieldConfig, parseThemeOverrides, publicSignupUrl, signupEmbedSnippet, SIGNUP_FIELD_DEFAULTS } from "@/lib/signup-form-config";
import type { SignupForm } from "@prisma/client";

export async function loadSignupBuilderOptions(location: { id: string; organizationId: string | null }, form?: SignupForm | null): Promise<SignupBuilderOptions> {
  const prisma = getPrisma();
  const orgFilter = { OR: [{ organizationId: location.organizationId }, { organizationId: null }] };
  const thirtyAgo = new Date(Date.now() - 30 * 86_400_000);
  const [plans, customFields, documents, discounts, tags, automations, signups30d, signupsTotal] = await Promise.all([
    prisma.membershipPlan.findMany({ where: { ...orgFilter, archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, category: true } }),
    prisma.customFieldDefinition.findMany({ where: orgFilter, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.document.findMany({ where: orgFilter, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.discount.findMany({ where: { ...orgFilter, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
    prisma.tag.findMany({ where: orgFilter, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.automation.findMany({ where: orgFilter, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    form ? prisma.member.count({ where: { locationId: location.id, source: { in: [`form:${form.slug}`, form.slug] }, joinDate: { gte: thirtyAgo } } }) : Promise.resolve(0),
    form ? prisma.member.count({ where: { locationId: location.id, source: { in: [`form:${form.slug}`, form.slug] } } }) : Promise.resolve(0),
  ]);
  return {
    plans,
    customFields,
    documents,
    discounts,
    tags,
    automations,
    publicUrl: form ? publicSignupUrl(form.slug) : null,
    embedSnippet: form ? signupEmbedSnippet(form.slug) : null,
    stats: form ? { signups30d, signupsTotal } : undefined,
  };
}

export function emptySignupDraft(): SignupFormDraft {
  return {
    name: "",
    slug: "",
    description: "",
    active: true,
    allowedPlanIds: [],
    defaultPlanId: "",
    requiredFields: { ...SIGNUP_FIELD_DEFAULTS },
    customFieldIds: [],
    requiredDocumentIds: [],
    allowDiscountCode: true,
    autoApplyDiscountId: "",
    photoRequired: false,
    authSetup: "MAGIC_LINK",
    themeOverrides: {},
    confirmationUrl: "",
    collectTax: false,
    autoTagIds: [],
    autoEnrollAutomationIds: [],
    embedAllowed: true,
  };
}

export function draftFromSignupForm(f: SignupForm): SignupFormDraft {
  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    description: f.description ?? "",
    active: f.active,
    allowedPlanIds: parseIdList(f.allowedPlanIds),
    defaultPlanId: f.defaultPlanId ?? "",
    requiredFields: parseSignupFieldConfig(f.requiredFields, { photoRequired: f.photoRequired }),
    customFieldIds: parseIdList(f.customFieldIds),
    requiredDocumentIds: parseIdList(f.requiredDocumentIds),
    allowDiscountCode: f.allowDiscountCode,
    autoApplyDiscountId: f.autoApplyDiscountId ?? "",
    photoRequired: f.photoRequired,
    authSetup: (["NONE", "MAGIC_LINK", "PASSWORD"].includes(f.authSetup) ? f.authSetup : "MAGIC_LINK") as SignupFormDraft["authSetup"],
    themeOverrides: parseThemeOverrides(f.themeOverrides),
    confirmationUrl: f.confirmationUrl ?? "",
    collectTax: f.collectTax,
    autoTagIds: parseIdList(f.autoTagIds),
    autoEnrollAutomationIds: parseIdList(f.autoEnrollAutomationIds),
    embedAllowed: f.embedAllowed,
  };
}
