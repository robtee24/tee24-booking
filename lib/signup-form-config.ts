// lib/signup-form-config.ts
//
// Shared contract between the admin Signup Form builder (marketing module)
// and the public renderer at app/signup/[slug] (billing module).
//
// ── Stored JSON shapes on `SignupForm` ──────────────────────────────────────
//
//  requiredFields  (Json)  →  { [field: SignupFieldKey]: "hidden" | "optional" | "required" }
//                            Missing keys fall back to SIGNUP_FIELD_DEFAULTS.
//                            Legacy shape (string[] of required keys) is also
//                            accepted by parseSignupFieldConfig(); every key in
//                            the array is "required", the rest use defaults.
//
//  allowedPlanIds           →  string[]  (MembershipPlan ids; empty = all active plans)
//  customFieldIds           →  string[]  (CustomFieldDefinition ids shown on the form)
//  requiredDocumentIds      →  string[]  (Document ids that must be signed at signup)
//  autoTagIds               →  string[]  (Tag ids applied to the new member)
//  autoEnrollAutomationIds  →  string[]  (Automation ids to enroll the new member in)
//  themeOverrides           →  { brandColor?: string; logoUrl?: string; buttonLabel?: string; headline?: string; intro?: string }
//
// Embedding: when `embedAllowed`, the public form is embeddable at
//   `${APP_BASE_URL}/signup/<slug>?embed=1` (renderer should hide chrome).
//
// Email, firstName and lastName can never be hidden (they are needed to create
// a Member) — the parser clamps them to at least "required".

export const SIGNUP_FIELD_KEYS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "dob",
  "gender",
  "address",
  "guardianName",
  "emergencyContact",
  "photo",
] as const;

export type SignupFieldKey = (typeof SIGNUP_FIELD_KEYS)[number];
export type SignupFieldMode = "hidden" | "optional" | "required";
export type SignupFieldConfig = Record<SignupFieldKey, SignupFieldMode>;

export const SIGNUP_FIELD_LABELS: Record<SignupFieldKey, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Mobile phone",
  dob: "Date of birth",
  gender: "Gender",
  address: "Address",
  guardianName: "Parent / guardian name",
  emergencyContact: "Emergency contact",
  photo: "Profile photo",
};

/** Fields that must always be collected to create a Member. */
export const SIGNUP_ALWAYS_REQUIRED: SignupFieldKey[] = ["firstName", "lastName", "email"];

export const SIGNUP_FIELD_DEFAULTS: SignupFieldConfig = {
  firstName: "required",
  lastName: "required",
  email: "required",
  phone: "required",
  dob: "optional",
  gender: "hidden",
  address: "optional",
  guardianName: "hidden",
  emergencyContact: "optional",
  photo: "hidden",
};

const MODES: SignupFieldMode[] = ["hidden", "optional", "required"];

/**
 * Parse `SignupForm.requiredFields` into a full SignupFieldConfig.
 * Accepts the canonical object shape, the legacy string[] shape, or null.
 */
export function parseSignupFieldConfig(raw: unknown, opts?: { photoRequired?: boolean }): SignupFieldConfig {
  const out: SignupFieldConfig = { ...SIGNUP_FIELD_DEFAULTS };
  if (Array.isArray(raw)) {
    for (const k of raw) {
      if (typeof k === "string" && (SIGNUP_FIELD_KEYS as readonly string[]).includes(k)) {
        out[k as SignupFieldKey] = "required";
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if ((SIGNUP_FIELD_KEYS as readonly string[]).includes(k) && typeof v === "string" && MODES.includes(v as SignupFieldMode)) {
        out[k as SignupFieldKey] = v as SignupFieldMode;
      }
    }
  }
  for (const k of SIGNUP_ALWAYS_REQUIRED) out[k] = "required";
  if (opts?.photoRequired) out.photo = "required";
  return out;
}

/** Normalise an unknown Json value into a string[] (ids). */
export function parseIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
}

export type SignupThemeOverrides = {
  brandColor?: string;
  logoUrl?: string;
  buttonLabel?: string;
  headline?: string;
  intro?: string;
};

export function parseThemeOverrides(raw: unknown): SignupThemeOverrides {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const pick = (k: keyof SignupThemeOverrides) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  return {
    brandColor: pick("brandColor"),
    logoUrl: pick("logoUrl"),
    buttonLabel: pick("buttonLabel"),
    headline: pick("headline"),
    intro: pick("intro"),
  };
}

export function publicSignupUrl(slug: string, opts?: { embed?: boolean }): string {
  const base = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/signup/${encodeURIComponent(slug)}${opts?.embed ? "?embed=1" : ""}`;
}

export function signupEmbedSnippet(slug: string): string {
  const src = publicSignupUrl(slug, { embed: true });
  return `<iframe src="${src}" width="100%" height="900" style="border:0;max-width:720px" loading="lazy" title="Join"></iframe>`;
}

/** Normalise an admin builder payload into SignupForm column values (admin API only). */
export function signupFormDataFromBody(body: Record<string, any>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.slug !== undefined) data.slug = slugify(String(body.slug));
  if (body.description !== undefined) data.description = body.description?.trim() || null;
  if (body.active !== undefined) data.active = !!body.active;
  if (body.allowedPlanIds !== undefined) data.allowedPlanIds = parseIdList(body.allowedPlanIds);
  if (body.defaultPlanId !== undefined) data.defaultPlanId = body.defaultPlanId || null;
  if (body.requiredFields !== undefined) data.requiredFields = parseSignupFieldConfig(body.requiredFields);
  if (body.customFieldIds !== undefined) data.customFieldIds = parseIdList(body.customFieldIds);
  if (body.requiredDocumentIds !== undefined) data.requiredDocumentIds = parseIdList(body.requiredDocumentIds);
  if (body.allowDiscountCode !== undefined) data.allowDiscountCode = !!body.allowDiscountCode;
  if (body.autoApplyDiscountId !== undefined) data.autoApplyDiscountId = body.autoApplyDiscountId || null;
  if (body.photoRequired !== undefined) data.photoRequired = !!body.photoRequired;
  if (body.authSetup !== undefined && ["NONE", "MAGIC_LINK", "PASSWORD"].includes(body.authSetup)) data.authSetup = body.authSetup;
  if (body.themeOverrides !== undefined) data.themeOverrides = body.themeOverrides ?? null;
  if (body.confirmationUrl !== undefined) data.confirmationUrl = body.confirmationUrl?.trim() || null;
  if (body.collectTax !== undefined) data.collectTax = !!body.collectTax;
  if (body.autoTagIds !== undefined) data.autoTagIds = parseIdList(body.autoTagIds);
  if (body.autoEnrollAutomationIds !== undefined) data.autoEnrollAutomationIds = parseIdList(body.autoEnrollAutomationIds);
  if (body.embedAllowed !== undefined) data.embedAllowed = !!body.embedAllowed;
  return data;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
