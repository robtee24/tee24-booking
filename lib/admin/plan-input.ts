/**
 * Shared parsing/validation for membership plan create & edit API bodies.
 * Returns only the keys that were present in the body (so PATCH is partial).
 */

export const PRODUCT_TYPES = ["RECURRING", "ONE_OFF", "DAY_PASS", "PUNCH_CARD", "BUNDLE", "COMP"] as const;
export const CATEGORIES = ["MEMBER", "VISITOR"] as const;
export const CADENCES = ["MONTHLY", "YEARLY", "WEEKLY", "ONE_OFF"] as const;

export type PlanPatch = {
  name?: string;
  description?: string | null;
  productType?: string;
  category?: string;
  priceCents?: number;
  signupFeeCents?: number;
  billingCadence?: string;
  durationDays?: number | null;
  familyBundle?: boolean;
  visitsPerPeriod?: number | null;
  visitPeriod?: string;
  guestAddonCents?: number | null;
  maxGuests?: number;
  dayPassGuestPricing?: number[] | null;
  sortOrder?: number;
  archived?: boolean;
};

export class PlanInputError extends Error {}

function intOrNull(v: unknown, label: string, min: number, max: number): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new PlanInputError(`${label} must be a whole number between ${min} and ${max}`);
  return n;
}

function cents(v: unknown, label: string): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) throw new PlanInputError(`${label} must be zero or more`);
  return n;
}

export function parsePlanBody(body: Record<string, unknown>): PlanPatch {
  const out: PlanPatch = {};
  if ("name" in body) {
    const name = String(body.name ?? "").trim().slice(0, 120);
    if (!name) throw new PlanInputError("Plan name is required");
    out.name = name;
  }
  if ("description" in body) out.description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) || null : null;
  if ("productType" in body) {
    if (!PRODUCT_TYPES.includes(body.productType as (typeof PRODUCT_TYPES)[number])) throw new PlanInputError("Invalid product type");
    out.productType = String(body.productType);
  }
  if ("category" in body) {
    if (!CATEGORIES.includes(body.category as (typeof CATEGORIES)[number])) throw new PlanInputError("Invalid category");
    out.category = String(body.category);
  }
  if ("priceCents" in body) out.priceCents = cents(body.priceCents ?? 0, "Price");
  if ("signupFeeCents" in body) out.signupFeeCents = cents(body.signupFeeCents ?? 0, "Signup fee");
  if ("billingCadence" in body) {
    if (!CADENCES.includes(body.billingCadence as (typeof CADENCES)[number])) throw new PlanInputError("Invalid billing cadence");
    out.billingCadence = String(body.billingCadence);
  }
  if ("durationDays" in body) out.durationDays = intOrNull(body.durationDays, "Duration", 1, 3650);
  if ("familyBundle" in body) out.familyBundle = !!body.familyBundle;
  if ("visitsPerPeriod" in body) out.visitsPerPeriod = intOrNull(body.visitsPerPeriod, "visitsPerPeriod", 1, 365);
  if ("visitPeriod" in body) {
    if (body.visitPeriod !== "ROLLING_MONTH" && body.visitPeriod !== "ROLLING_WEEK") throw new PlanInputError("visitPeriod must be ROLLING_MONTH or ROLLING_WEEK");
    out.visitPeriod = body.visitPeriod;
  }
  if ("guestAddonCents" in body) out.guestAddonCents = body.guestAddonCents === null || body.guestAddonCents === "" ? null : cents(body.guestAddonCents, "Guest add-on price");
  if ("maxGuests" in body) out.maxGuests = intOrNull(body.maxGuests, "Max guests", 0, 10) ?? 0;
  if ("dayPassGuestPricing" in body) {
    const raw = body.dayPassGuestPricing;
    if (raw === null || raw === undefined || (Array.isArray(raw) && raw.length === 0)) out.dayPassGuestPricing = null;
    else if (Array.isArray(raw)) {
      if (raw.length > 10) throw new PlanInputError("At most 10 guest price tiers");
      out.dayPassGuestPricing = raw.map((v, i) => cents(v, `Guest ${i + 1} price`));
    } else throw new PlanInputError("dayPassGuestPricing must be a list of cents");
  }
  if ("sortOrder" in body) out.sortOrder = Math.round(Number(body.sortOrder) || 0);
  if ("archived" in body) out.archived = !!body.archived;
  return out;
}
