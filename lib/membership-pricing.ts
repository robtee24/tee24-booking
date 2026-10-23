/**
 * Membership pricing helpers shared by the signup form (preview), the signup
 * API (authoritative), recurring billing and the admin membership editors.
 *
 * Guest add-ons
 *  - Recurring plans: `guestAddonCents` per guest per billing period, up to
 *    `maxGuests`. The membership is shown as "<plan> + Guest" / "+ 2 Guests".
 *  - Day passes: `dayPassGuestPricing` is a per-guest tier list, e.g.
 *    [1500, 1000, 500] → guest #1 $15, #2 $10, #3 $5 (cumulative).
 *
 * A subscription stores `guestCount` and `guestCents` (total guest cents per
 * period); `priceCents` already includes `guestCents`.
 */

export type GuestPlanFields = {
  productType: string;
  guestAddonCents: number | null;
  maxGuests: number;
  dayPassGuestPricing: unknown;
};

export function dayPassGuestTiers(plan: Pick<GuestPlanFields, "dayPassGuestPricing">): number[] {
  const raw = plan.dayPassGuestPricing;
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => Math.max(0, Math.round(Number(v)))).filter((v) => Number.isFinite(v));
}

/** How many guests this plan lets a member add at signup (0 = no guest option). */
export function maxGuestsFor(plan: GuestPlanFields): number {
  if (plan.productType === "DAY_PASS") return Math.min(plan.maxGuests || dayPassGuestTiers(plan).length, dayPassGuestTiers(plan).length);
  if (plan.guestAddonCents == null || plan.guestAddonCents < 0) return 0;
  return Math.max(0, plan.maxGuests);
}

export function planOffersGuests(plan: GuestPlanFields): boolean {
  return maxGuestsFor(plan) > 0;
}

/** Total guest cents (per period for recurring, one-off for day passes) for `count` guests. */
export function guestCentsFor(plan: GuestPlanFields, count: number): number {
  const n = Math.max(0, Math.min(Math.floor(count), maxGuestsFor(plan)));
  if (n === 0) return 0;
  if (plan.productType === "DAY_PASS") return dayPassGuestTiers(plan).slice(0, n).reduce((s, c) => s + c, 0);
  return n * (plan.guestAddonCents ?? 0);
}

/** Incremental price of guest number `n` (1-based). */
export function guestIncrementCents(plan: GuestPlanFields, n: number): number {
  if (plan.productType === "DAY_PASS") return dayPassGuestTiers(plan)[n - 1] ?? 0;
  return plan.guestAddonCents ?? 0;
}

/**
 * "The Tin Cup" + 1 → "The Tin Cup + Guest"; + 2 → "The Tin Cup + 2 Guests".
 * Day passes keep their plain name (guests are a one-time add-on, not part of the membership).
 */
export function membershipDisplayName(planName: string, guestCount: number, productType?: string | null): string {
  if (productType === "DAY_PASS") return planName;
  if (!guestCount || guestCount < 1) return planName;
  return guestCount === 1 ? `${planName} + Guest` : `${planName} + ${guestCount} Guests`;
}

/** Short tag for a promo / discount attached to a subscription, e.g. "25% off", "$10 off", or the code. */
export function promoTagLabel(d: { type: string; value: number; code?: string | null; name?: string | null }): string {
  if (d.type === "PERCENT" && d.value > 0) return `${d.value}% off`;
  if (d.type !== "PERCENT" && d.value > 0) return `$${(d.value / 100).toFixed(d.value % 100 === 0 ? 0 : 2)} off`;
  return d.code || d.name || "Promo";
}

export function guestLineLabel(guestCount: number, productType: string): string {
  const who = guestCount === 1 ? "1 guest" : `${guestCount} guests`;
  return productType === "DAY_PASS" ? `${who} (today)` : `${who} on every visit`;
}

/** Add N billing periods to a date (MONTHLY/YEARLY/WEEKLY). */
export function addPeriods(date: Date, cadence: string | null | undefined, periods: number): Date {
  const d = new Date(date);
  const c = (cadence ?? "MONTHLY").toUpperCase();
  if (c === "YEARLY" || c === "ANNUAL") d.setFullYear(d.getFullYear() + periods);
  else if (c === "WEEKLY") d.setDate(d.getDate() + 7 * periods);
  else d.setMonth(d.getMonth() + periods);
  return d;
}

export type CommitmentFields = { commitmentEndsAt: Date | string | null; earlyCancelFeeCents: number | null };

/** The early-cancellation fee that applies if this subscription is cancelled at `now`. */
export function earlyCancelFeeDue(sub: CommitmentFields, now = new Date()): number {
  if (!sub.commitmentEndsAt || !sub.earlyCancelFeeCents || sub.earlyCancelFeeCents <= 0) return 0;
  const ends = new Date(sub.commitmentEndsAt);
  return ends.getTime() > now.getTime() ? sub.earlyCancelFeeCents : 0;
}

/** Promo fields exposed to the public signup form. */
export type SignupPromo = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  type: string;
  value: number;
  scope: string;
  recurringMonths: number | null;
  requiresIdUpload: boolean;
  idUploadLabel: string | null;
  commitmentMonths: number | null;
  commitmentAcknowledgement: string | null;
  planIds: string[]; // empty = all plans
};
