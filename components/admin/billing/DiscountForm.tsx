"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, Input, Modal, Select, useToast } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";

export type DiscountFormValues = {
  code: string;
  name: string;
  type: "PERCENT" | "FIXED";
  value: string; // percent or dollars (UI)
  scope: "ONE_TIME" | "RECURRING" | "FOREVER";
  recurringMonths: string;
  maxRedemptions: string;
  perMemberLimit: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
  planIds: string[];
  signupFormIds: string[];
};

export const EMPTY_DISCOUNT: DiscountFormValues = {
  code: "",
  name: "",
  type: "PERCENT",
  value: "",
  scope: "ONE_TIME",
  recurringMonths: "3",
  maxRedemptions: "",
  perMemberLimit: "1",
  startsAt: "",
  endsAt: "",
  active: true,
  planIds: [],
  signupFormIds: [],
};

export function DiscountForm({
  slug,
  discountId,
  initial,
  plans,
  signupForms,
}: {
  slug: string;
  discountId?: string;
  initial: DiscountFormValues;
  plans: Array<{ id: string; name: string }>;
  signupForms: Array<{ id: string; name: string; slug: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [v, setV] = React.useState<DiscountFormValues>(initial);
  const [saving, setSaving] = React.useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = React.useState(false);
  const set = <K extends keyof DiscountFormValues>(k: K, val: DiscountFormValues[K]) => setV((s) => ({ ...s, [k]: val }));

  const valid = v.code.trim().length >= 2 && v.name.trim() && Number(v.value) > 0 && (v.type !== "PERCENT" || Number(v.value) <= 100) && (v.scope !== "RECURRING" || Number(v.recurringMonths) >= 1);

  async function save() {
    setSaving(true);
    try {
      const body = {
        locationSlug: slug,
        code: v.code.trim().toUpperCase(),
        name: v.name.trim(),
        type: v.type,
        value: v.type === "PERCENT" ? Math.round(Number(v.value)) : Math.round(Number(v.value) * 100),
        scope: v.scope,
        recurringMonths: v.scope === "RECURRING" ? Math.round(Number(v.recurringMonths)) : null,
        maxRedemptions: v.maxRedemptions ? Math.round(Number(v.maxRedemptions)) : null,
        perMemberLimit: v.perMemberLimit ? Math.round(Number(v.perMemberLimit)) : null,
        startsAt: v.startsAt || null,
        endsAt: v.endsAt || null,
        active: v.active,
        planIds: v.planIds,
        signupFormIds: v.signupFormIds.length ? v.signupFormIds : null,
      };
      const res = await fetch(discountId ? `/api/admin/discounts/${discountId}` : "/api/admin/discounts", {
        method: discountId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not save discount");
      toast({ tone: "success", title: discountId ? "Discount updated" : `Discount ${body.code} created` });
      if (discountId) router.refresh();
      else router.push(adminRoutes.loc.billing.discountDetail(slug, json.discount.id));
    } catch (e) {
      toast({ tone: "error", title: "Save failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    if (!discountId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/discounts/${discountId}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not deactivate");
      toast({ tone: "success", title: "Discount deactivated", description: "Existing members keep their discount; new redemptions are blocked." });
      setConfirmDeactivate(false);
      setV((s) => ({ ...s, active: false }));
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Deactivate failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  function toggleIn(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Discount" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Code" value={v.code} onChange={(e) => set("code", e.target.value.toUpperCase().replace(/\s+/g, ""))} placeholder="SUMMER25" hint="Members enter this at signup. Letters and numbers." required />
          <Input label="Name" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Summer promo" required />
          <Select label="Type" value={v.type} onChange={(e) => set("type", e.target.value as DiscountFormValues["type"])}>
            <option value="PERCENT">Percent off</option>
            <option value="FIXED">Fixed amount off</option>
          </Select>
          <Input label={v.type === "PERCENT" ? "Percent" : "Amount"} type="number" min={0} max={v.type === "PERCENT" ? 100 : undefined} step={v.type === "PERCENT" ? 1 : 0.01} prefix={v.type === "FIXED" ? "$" : undefined} suffix={v.type === "PERCENT" ? "%" : undefined} value={v.value} onChange={(e) => set("value", e.target.value)} required />
          <Select label="Applies to" value={v.scope} onChange={(e) => set("scope", e.target.value as DiscountFormValues["scope"])} hint={v.scope === "ONE_TIME" ? "First invoice only (signup / first payment)." : v.scope === "RECURRING" ? "First N recurring payments, then full price." : "Every payment for as long as the subscription lasts."}>
            <option value="ONE_TIME">First payment only</option>
            <option value="RECURRING">First N payments</option>
            <option value="FOREVER">Every payment</option>
          </Select>
          {v.scope === "RECURRING" && <Input label="Number of payments" type="number" min={1} value={v.recurringMonths} onChange={(e) => set("recurringMonths", e.target.value)} />}
        </div>
      </Card>

      <Card>
        <CardHeader title="Limits & schedule" subtitle="Leave blank for no limit." />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Total redemptions" type="number" min={1} value={v.maxRedemptions} onChange={(e) => set("maxRedemptions", e.target.value)} placeholder="Unlimited" />
          <Input label="Per member" type="number" min={1} value={v.perMemberLimit} onChange={(e) => set("perMemberLimit", e.target.value)} placeholder="Unlimited" />
          <Input label="Starts" type="date" value={v.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
          <Input label="Ends" type="date" value={v.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Eligibility" subtitle="Restrict to specific plans or signup forms. Nothing selected = all." />
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <div>
            <div className="mb-2 text-apple-xs font-medium text-apple-text-secondary">Plans</div>
            {plans.length === 0 ? <p className="text-apple-sm text-apple-text-tertiary">No plans yet.</p> : (
              <ul className="space-y-1.5">
                {plans.map((p) => (
                  <li key={p.id}>
                    <label className="flex items-center gap-2 text-apple-sm text-apple-text">
                      <input type="checkbox" className="h-4 w-4 accent-apple-blue" checked={v.planIds.includes(p.id)} onChange={() => set("planIds", toggleIn(v.planIds, p.id))} />
                      {p.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-2 text-apple-xs font-medium text-apple-text-secondary">Signup forms</div>
            {signupForms.length === 0 ? <p className="text-apple-sm text-apple-text-tertiary">No signup forms yet.</p> : (
              <ul className="space-y-1.5">
                {signupForms.map((f) => (
                  <li key={f.id}>
                    <label className="flex items-center gap-2 text-apple-sm text-apple-text">
                      <input type="checkbox" className="h-4 w-4 accent-apple-blue" checked={v.signupFormIds.includes(f.id)} onChange={() => set("signupFormIds", toggleIn(v.signupFormIds, f.id))} />
                      {f.name} <span className="text-apple-xs text-apple-text-tertiary">/{f.slug}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {discountId && v.active && (
            <Button variant="danger" onClick={() => setConfirmDeactivate(true)} disabled={saving}>Deactivate</Button>
          )}
          {discountId && !v.active && (
            <Button variant="secondary" onClick={() => { set("active", true); }} disabled={saving}>Reactivate (then save)</Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.push(adminRoutes.loc.billing.discounts(slug))} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!valid}>{discountId ? "Save changes" : "Create discount"}</Button>
        </div>
      </div>

      <Modal
        open={confirmDeactivate}
        onClose={() => setConfirmDeactivate(false)}
        title={`Deactivate ${v.code}?`}
        description="New redemptions will be rejected. Members already enrolled keep their recurring discount."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDeactivate(false)}>Cancel</Button>
            <Button variant="danger" loading={saving} onClick={deactivate}>Deactivate</Button>
          </>
        }
      >
        <p className="text-apple-sm text-apple-text-secondary">You can reactivate it later from this page.</p>
      </Modal>
    </div>
  );
}
