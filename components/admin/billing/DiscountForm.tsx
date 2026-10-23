"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
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
  // Signup promotion
  showOnSignup: boolean;
  signupTitle: string;
  signupDescription: string;
  requiresIdUpload: boolean;
  idUploadLabel: string;
  commitmentMonths: string;
  commitmentAcknowledgement: string;
  chargeDiscountBackOnEarlyCancel: boolean;
  sortOrder: string;
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
  showOnSignup: false,
  signupTitle: "",
  signupDescription: "",
  requiresIdUpload: false,
  idUploadLabel: "",
  commitmentMonths: "",
  commitmentAcknowledgement: "",
  chargeDiscountBackOnEarlyCancel: true,
  sortOrder: "0",
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
        showOnSignup: v.showOnSignup,
        signupTitle: v.signupTitle.trim() || null,
        signupDescription: v.signupDescription.trim() || null,
        requiresIdUpload: v.showOnSignup && v.requiresIdUpload,
        idUploadLabel: v.idUploadLabel.trim() || null,
        commitmentMonths: v.showOnSignup && v.commitmentMonths ? Math.round(Number(v.commitmentMonths)) : null,
        commitmentAcknowledgement: v.commitmentAcknowledgement.trim() || null,
        earlyCancelPolicy: v.showOnSignup && v.commitmentMonths ? (v.chargeDiscountBackOnEarlyCancel ? "CHARGE_DISCOUNT_BACK" : "NONE") : null,
        sortOrder: Math.round(Number(v.sortOrder) || 0),
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
        <CardHeader title="Signup promotion" subtitle="Show this discount as a selectable offer in the “Current promotions” section of the signup form — no code needed." />
        <div className="mt-4 space-y-4">
          <label className="flex items-start gap-2 text-apple-sm text-apple-text">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-apple-blue" checked={v.showOnSignup} onChange={(e) => set("showOnSignup", e.target.checked)} />
            <span>
              Offer on the signup form
              <span className="block text-apple-xs text-apple-text-tertiary">Members pick it in step 1. Plan and form restrictions below still apply.</span>
            </span>
          </label>
          {v.showOnSignup && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Title shown to members" value={v.signupTitle} onChange={(e) => set("signupTitle", e.target.value)} placeholder={v.name || "25% off for heroes"} hint="Defaults to the discount name." />
                <Input label="Display order" type="number" value={v.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} hint="Lower shows first." />
              </div>
              <Textarea label="Description" rows={2} value={v.signupDescription} onChange={(e) => set("signupDescription", e.target.value)} placeholder="Active military, veterans, first responders, students and seniors (55+)." />

              <div className="rounded-apple border border-apple-border p-3">
                <label className="flex items-start gap-2 text-apple-sm text-apple-text">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-apple-blue" checked={v.requiresIdUpload} onChange={(e) => set("requiresIdUpload", e.target.checked)} />
                  <span>
                    Require an ID upload
                    <span className="block text-apple-xs text-apple-text-tertiary">The member must attach a photo or PDF of their qualifying ID before they can continue. Staff review it from the member’s Memberships tab.</span>
                  </span>
                </label>
                {v.requiresIdUpload && (
                  <div className="mt-3">
                    <Input label="Upload prompt" value={v.idUploadLabel} onChange={(e) => set("idUploadLabel", e.target.value)} placeholder="Upload your military, first responder, student or government ID" />
                  </div>
                )}
              </div>

              <div className="rounded-apple border border-apple-border p-3">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input label="Minimum term (billing periods)" type="number" min={1} max={36} value={v.commitmentMonths} onChange={(e) => set("commitmentMonths", e.target.value)} placeholder="None" hint="e.g. 2 for “first month half off, 2-month minimum”." />
                </div>
                {v.commitmentMonths && (
                  <div className="mt-3 space-y-3">
                    <Textarea label="Acknowledgement the member must check" rows={2} value={v.commitmentAcknowledgement} onChange={(e) => set("commitmentAcknowledgement", e.target.value)} placeholder="I understand that if I cancel before my second month, I'll be charged the other half of my first month." />
                    <label className="flex items-start gap-2 text-apple-sm text-apple-text">
                      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-apple-blue" checked={v.chargeDiscountBackOnEarlyCancel} onChange={(e) => set("chargeDiscountBackOnEarlyCancel", e.target.checked)} />
                      <span>
                        Charge the discounted amount back on early cancellation
                        <span className="block text-apple-xs text-apple-text-tertiary">When a member cancels before the minimum term ends, the amount this promotion took off is invoiced and charged to their card on file.</span>
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </>
          )}
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
