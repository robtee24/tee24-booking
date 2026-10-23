"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, Input, Select, Textarea, useToast } from "@/components/ui";

export type PlanFormValues = {
  name: string;
  description: string;
  productType: string;
  category: string;
  signupFee: string;
  price: string;
  billingCadence: string;
  durationDays: string;
  familyBundle: boolean;
  visitsPerPeriod: string;
  visitPeriod: string;
  // Guests
  guestAddon: string; // dollars per guest per period (recurring)
  maxGuests: string;
  dayPassGuestPrices: string[]; // dollars per guest tier (day pass)
  sortOrder: string;
  archived: boolean;
};

export const EMPTY_PLAN: PlanFormValues = {
  name: "",
  description: "",
  productType: "RECURRING",
  category: "MEMBER",
  signupFee: "0",
  price: "0",
  billingCadence: "MONTHLY",
  durationDays: "",
  familyBundle: false,
  visitsPerPeriod: "",
  visitPeriod: "ROLLING_MONTH",
  guestAddon: "",
  maxGuests: "0",
  dayPassGuestPrices: ["", "", ""],
  sortOrder: "0",
  archived: false,
};

const dollars = (cents: number | null | undefined) => (cents == null ? "" : (cents / 100).toFixed(2));
const toCents = (v: string) => Math.round(Number(v) * 100) || 0;

/** Map a MembershipPlan row (as serialised to the client) into form values. */
export function planToFormValues(p: {
  name: string;
  description: string | null;
  productType: string;
  category: string;
  signupFeeCents: number;
  priceCents: number;
  billingCadence: string;
  durationDays: number | null;
  familyBundle: boolean;
  visitsPerPeriod: number | null;
  visitPeriod: string;
  guestAddonCents: number | null;
  maxGuests: number;
  dayPassGuestPricing: unknown;
  sortOrder: number;
  archived: boolean;
}): PlanFormValues {
  const tiers = Array.isArray(p.dayPassGuestPricing) ? (p.dayPassGuestPricing as number[]).map((c) => dollars(c)) : [];
  while (tiers.length < 3) tiers.push("");
  return {
    name: p.name,
    description: p.description ?? "",
    productType: p.productType,
    category: p.category,
    signupFee: dollars(p.signupFeeCents),
    price: dollars(p.priceCents),
    billingCadence: p.billingCadence,
    durationDays: p.durationDays?.toString() ?? "",
    familyBundle: p.familyBundle,
    visitsPerPeriod: p.visitsPerPeriod?.toString() ?? "",
    visitPeriod: p.visitPeriod || "ROLLING_MONTH",
    guestAddon: dollars(p.guestAddonCents),
    maxGuests: String(p.maxGuests ?? 0),
    dayPassGuestPrices: tiers,
    sortOrder: String(p.sortOrder ?? 0),
    archived: p.archived,
  };
}

export function PlanForm({
  slug,
  planId,
  initial,
  activeSubscriptions = 0,
}: {
  slug: string;
  /** When set, the form edits this plan (PATCH); otherwise it creates one (POST). */
  planId?: string;
  initial: PlanFormValues;
  activeSubscriptions?: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState<PlanFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!planId;
  const isDayPass = form.productType === "DAY_PASS";
  const isRecurring = form.productType === "RECURRING";

  function set<K extends keyof PlanFormValues>(k: K, v: PlanFormValues[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function setTier(i: number, v: string) {
    setForm((f) => {
      const next = [...f.dayPassGuestPrices];
      next[i] = v;
      return { ...f, dayPassGuestPrices: next };
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const tiers = isDayPass ? form.dayPassGuestPrices.map((v) => v.trim()).filter((v) => v !== "").map(toCents) : [];
      const payload = {
        locationSlug: slug,
        name: form.name,
        description: form.description || null,
        productType: form.productType,
        category: form.category,
        priceCents: toCents(form.price),
        signupFeeCents: toCents(form.signupFee),
        billingCadence: form.billingCadence,
        durationDays: form.durationDays ? Number(form.durationDays) : null,
        familyBundle: form.familyBundle,
        visitsPerPeriod: form.visitsPerPeriod ? Number(form.visitsPerPeriod) : null,
        visitPeriod: form.visitPeriod,
        guestAddonCents: !isDayPass && form.guestAddon.trim() !== "" ? toCents(form.guestAddon) : null,
        maxGuests: isDayPass ? tiers.length : form.guestAddon.trim() !== "" ? Number(form.maxGuests) || 0 : 0,
        dayPassGuestPricing: isDayPass && tiers.length ? tiers : null,
        sortOrder: Number(form.sortOrder) || 0,
        archived: form.archived,
      };
      const res = await fetch(isEdit ? `/api/admin/memberships/${planId}` : "/api/admin/memberships", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      toast({ tone: "success", title: isEdit ? "Plan updated" : "Plan created" });
      router.push(`/admin/locations/${slug}/members/memberships`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Basics" />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Plan name" required value={form.name} onChange={(e) => set("name", e.target.value)} />
            <Select label="Product type" value={form.productType} onChange={(e) => set("productType", e.target.value)}>
              <option value="RECURRING">Recurring membership</option>
              <option value="ONE_OFF">One-off (e.g. annual)</option>
              <option value="DAY_PASS">Day pass</option>
              <option value="PUNCH_CARD">Punch card</option>
              <option value="BUNDLE">Bundle</option>
              <option value="COMP">Comp / sponsored</option>
            </Select>
            <Select label="Category" value={form.category} onChange={(e) => set("category", e.target.value)}>
              <option value="MEMBER">Member</option>
              <option value="VISITOR">Visitor</option>
            </Select>
            <Input label="Display order" type="number" value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} hint="Lower shows first on the signup form." />
            <div className="sm:col-span-2">
              <Textarea label="Description" rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} hint="Shown to members on the signup form — keep it customer-facing." />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Pricing"
            subtitle={isEdit && activeSubscriptions > 0 ? `Changing the price here affects new signups and plan changes only — the ${activeSubscriptions} current subscription${activeSubscriptions === 1 ? "" : "s"} keep the price they signed up at.` : undefined}
          />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input label="Price ($)" type="number" min="0" step="0.01" value={form.price} onChange={(e) => set("price", e.target.value)} />
            <Input label="Signup fee ($)" type="number" min="0" step="0.01" value={form.signupFee} onChange={(e) => set("signupFee", e.target.value)} />
            <Select label="Billing cadence" value={form.billingCadence} onChange={(e) => set("billingCadence", e.target.value)}>
              <option value="MONTHLY">Monthly</option>
              <option value="YEARLY">Yearly</option>
              <option value="WEEKLY">Weekly</option>
              <option value="ONE_OFF">One-off</option>
            </Select>
            <Input label="Duration (days, optional)" type="number" min="0" value={form.durationDays} onChange={(e) => set("durationDays", e.target.value)} hint="For day passes / fixed-term plans" />
          </div>
          <div className="mt-3">
            <label className="flex items-center gap-2 text-apple-sm text-apple-text">
              <input type="checkbox" checked={form.familyBundle} onChange={(e) => set("familyBundle", e.target.checked)} className="h-4 w-4 rounded accent-apple-blue" />
              Family bundle
            </label>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Guests"
            subtitle={
              isDayPass
                ? "Ask day-pass buyers how many guests are coming and price each one. Leave all blank for no guest option."
                : "Let members add a complimentary guest on every visit for a monthly add-on. The membership shows as “Plan + Guest”. Leave blank for no guest option."
            }
          />
          {isDayPass ? (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {form.dayPassGuestPrices.map((v, i) => (
                <Input key={i} label={`Guest ${i + 1} ($)`} type="number" min="0" step="0.01" value={v} onChange={(e) => setTier(i, e.target.value)} placeholder="—" hint={i === 0 ? "Price of the first guest" : `Added when they bring a ${i + 1}${i === 1 ? "nd" : "rd"} guest`} />
              ))}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input label={`Guest add-on ($ per guest / ${form.billingCadence === "YEARLY" ? "year" : form.billingCadence === "WEEKLY" ? "week" : "month"})`} type="number" min="0" step="0.01" value={form.guestAddon} onChange={(e) => set("guestAddon", e.target.value)} placeholder="No guest option" />
              <Input label="Max guests" type="number" min="0" max="10" value={form.maxGuests} onChange={(e) => set("maxGuests", e.target.value)} disabled={form.guestAddon.trim() === ""} hint="Each guest adds the add-on price." />
            </div>
          )}
          {!isDayPass && !isRecurring && <p className="mt-2 text-apple-xs text-apple-text-tertiary">Guest add-ons are billed with each period; for one-off plans the add-on is charged once.</p>}
        </Card>

        <Card>
          <CardHeader title="Visit allowance" subtitle="Enforced when members unlock the door from the app. Leave blank for unlimited. Multiple visits on the same day count once." />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Visits per period" type="number" min="1" max="365" value={form.visitsPerPeriod} onChange={(e) => set("visitsPerPeriod", e.target.value)} placeholder="Unlimited" hint="e.g. 3 for The Noonan" />
            <Select label="Period" value={form.visitPeriod} onChange={(e) => set("visitPeriod", e.target.value)} hint="Rolling from the member's signup day, not the calendar month.">
              <option value="ROLLING_MONTH">Rolling month (from signup day)</option>
              <option value="ROLLING_WEEK">Rolling week</option>
            </Select>
          </div>
        </Card>

        {isEdit && (
          <Card>
            <CardHeader title="Availability" />
            <label className="mt-4 flex items-start gap-2 text-apple-sm text-apple-text">
              <input type="checkbox" checked={form.archived} onChange={(e) => set("archived", e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-apple-blue" />
              <span>
                Archived
                <span className="block text-apple-xs text-apple-text-tertiary">Hidden from signup forms and new subscriptions. Existing subscriptions keep billing as normal.</span>
              </span>
            </label>
          </Card>
        )}

        {error && <p className="text-apple-sm text-apple-red">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" type="button" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" loading={saving}>{isEdit ? "Save changes" : "Create plan"}</Button>
        </div>
      </div>
    </form>
  );
}
