"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Input, Select, useToast } from "@/components/ui";
import { Field, SettingsSection, Toggle } from "@/components/admin/location-settings/SettingsSection";

export type BillingSettingsValues = {
  currency: string;
  taxRateBps: number;
  cardSurchargeBps: number;
  dunningRetryDays: number[];
  lateFeeCents: number;
  overdueBlockDays: number | null;
  unpaidRenewalAction: "CANCEL" | "KEEP_OPEN";
};

type Section = "tax" | "dunning" | "general";

async function patchSettings(slug: string, patch: Partial<BillingSettingsValues>) {
  const res = await fetch("/api/admin/billing/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locationSlug: slug, ...patch }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Save failed");
  return json.settings as BillingSettingsValues;
}

/**
 * Tax section — shared between Billing → Settings and Settings → Tax so both
 * pages edit the same `Location.taxRateBps`.
 */
export function TaxSettingsSection({ slug, settings, canEdit = true }: { slug: string; settings: BillingSettingsValues; canEdit?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [rate, setRate] = React.useState((settings.taxRateBps / 100).toFixed(2));
  const [enabled, setEnabled] = React.useState(settings.taxRateBps > 0);

  async function save() {
    setSaving(true);
    try {
      const bps = enabled ? Math.round(Number(rate) * 100) : 0;
      if (!Number.isFinite(bps) || bps < 0 || bps > 5000) throw new Error("Tax rate must be between 0% and 50%");
      await patchSettings(slug, { taxRateBps: bps });
      toast({ tone: "success", title: "Tax settings saved" });
      setEditing(false);
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Could not save", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      title="Sales tax"
      description="Applied to the taxable subtotal (after discounts) of every invoice issued at this location. Signup forms can opt out per form."
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancel={() => {
        setEditing(false);
        setRate((settings.taxRateBps / 100).toFixed(2));
        setEnabled(settings.taxRateBps > 0);
      }}
      onSave={save}
      saving={saving}
      canEdit={canEdit}
    >
      {editing ? (
        <div className="space-y-4">
          <Toggle checked={enabled} onChange={setEnabled} label="Collect sales tax" hint="When off, invoices are issued with 0% tax." />
          {enabled && (
            <div className="max-w-xs">
              <Input label="Tax rate" type="number" min={0} max={50} step="0.01" suffix="%" value={rate} onChange={(e) => setRate(e.target.value)} hint="e.g. 9.75 for Clarksville, TN (7% state + 2.75% local)" />
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Status" value={settings.taxRateBps > 0 ? "Collecting" : "Not collected"} />
          <Field label="Rate" value={`${(settings.taxRateBps / 100).toFixed(2)}%`} />
        </div>
      )}
    </SettingsSection>
  );
}

/** "3, 5, 7, 7" → "due date, then day 3, 8, 15, 22". */
function retryScheduleSummary(raw: string): string {
  const days = raw.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!days.length) return "due date only";
  let acc = 0;
  const offsets = days.map((d) => (acc += d));
  return `due date, then day ${offsets.join(", ")}`;
}

/** General (currency + card surcharge) and dunning (retry schedule, late fee, overdue block) sections. */
export function BillingSettingsForm({ slug, settings, canEdit = true }: { slug: string; settings: BillingSettingsValues; canEdit?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<Section | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [draft, setDraft] = React.useState({
    currency: settings.currency,
    surcharge: (settings.cardSurchargeBps / 100).toFixed(2),
    retryDays: settings.dunningRetryDays.join(", "),
    lateFee: (settings.lateFeeCents / 100).toFixed(2),
    blockDays: settings.overdueBlockDays != null ? String(settings.overdueBlockDays) : "",
    unpaidRenewalAction: settings.unpaidRenewalAction,
  });

  function reset() {
    setDraft({
      currency: settings.currency,
      surcharge: (settings.cardSurchargeBps / 100).toFixed(2),
      retryDays: settings.dunningRetryDays.join(", "),
      lateFee: (settings.lateFeeCents / 100).toFixed(2),
      blockDays: settings.overdueBlockDays != null ? String(settings.overdueBlockDays) : "",
      unpaidRenewalAction: settings.unpaidRenewalAction,
    });
    setEditing(null);
  }

  async function save(section: Section) {
    setSaving(true);
    try {
      let patch: Partial<BillingSettingsValues> = {};
      if (section === "general") {
        const bps = Math.round(Number(draft.surcharge) * 100);
        if (!Number.isFinite(bps) || bps < 0 || bps > 1000) throw new Error("Surcharge must be between 0% and 10%");
        patch = { currency: draft.currency, cardSurchargeBps: bps };
      } else if (section === "dunning") {
        const days = draft.retryDays.split(/[,\s]+/).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
        if (days.length === 0) throw new Error("Enter at least one retry day, e.g. 1, 3, 7");
        const lateFeeCents = Math.round(Number(draft.lateFee) * 100);
        if (!Number.isFinite(lateFeeCents) || lateFeeCents < 0) throw new Error("Late fee must be zero or positive");
        const blockDays = draft.blockDays.trim() === "" ? null : Math.round(Number(draft.blockDays));
        if (blockDays != null && (!Number.isFinite(blockDays) || blockDays < 0)) throw new Error("Block days must be zero or positive");
        patch = { dunningRetryDays: days, lateFeeCents, overdueBlockDays: blockDays, unpaidRenewalAction: draft.unpaidRenewalAction };
      }
      await patchSettings(slug, patch);
      toast({ tone: "success", title: "Billing settings saved" });
      setEditing(null);
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Could not save", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SettingsSection
        title="Failed payments & retries"
        description="What happens when a card is declined. The first attempt is on the due date; each retry is texted/emailed to the member and access is blocked while an invoice is past due. A new default card is charged immediately."
        editing={editing === "dunning"}
        onEdit={() => setEditing("dunning")}
        onCancel={reset}
        onSave={() => save("dunning")}
        saving={saving}
        canEdit={canEdit && editing !== "general"}
      >
        {editing === "dunning" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Retry after (days between attempts)" value={draft.retryDays} onChange={(e) => setDraft((d) => ({ ...d, retryDays: e.target.value }))} hint={`e.g. 3, 5, 7, 7 → ${retryScheduleSummary(draft.retryDays)}`} />
            <Select label="Still unpaid at the next renewal" value={draft.unpaidRenewalAction} onChange={(e) => setDraft((d) => ({ ...d, unpaidRenewalAction: e.target.value as "CANCEL" | "KEEP_OPEN" }))} hint="One final charge is attempted first. Cancelling voids the unpaid invoice so members never stack up multiple open invoices.">
              <option value="CANCEL">Void the invoice and cancel the membership</option>
              <option value="KEEP_OPEN">Keep the invoice open and bill the next period too</option>
            </Select>
            <Input label="Late fee" type="number" min={0} step="0.01" prefix="$" value={draft.lateFee} onChange={(e) => setDraft((d) => ({ ...d, lateFee: e.target.value }))} hint="Added once, after the final retry fails. 0 = none." />
            <Input label="Block access after (days)" type="number" min={0} value={draft.blockDays} onChange={(e) => setDraft((d) => ({ ...d, blockDays: e.target.value }))} placeholder="Immediately" hint="Grace period before door access is disabled for an overdue member." />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Attempts" value={`${settings.dunningRetryDays.length + 1} total — ${retryScheduleSummary(settings.dunningRetryDays.join(","))}`} />
            <Field label="Unpaid at renewal" value={settings.unpaidRenewalAction === "CANCEL" ? "Void invoice & cancel membership" : "Keep open, bill next period"} />
            <Field label="Late fee" value={settings.lateFeeCents > 0 ? `$${(settings.lateFeeCents / 100).toFixed(2)}` : "None"} />
            <Field label="Access block" value={settings.overdueBlockDays == null || settings.overdueBlockDays === 0 ? "Immediately when overdue" : `${settings.overdueBlockDays} days after due`} />
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Currency & card surcharge"
        description="A surcharge is added only to invoices paid by card (never to cash/check). Check your state's surcharge rules and Square's cap (typically ≤ 3–4%)."
        editing={editing === "general"}
        onEdit={() => setEditing("general")}
        onCancel={reset}
        onSave={() => save("general")}
        saving={saving}
        canEdit={canEdit && editing !== "dunning"}
      >
        {editing === "general" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select label="Currency" value={draft.currency} onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))}>
              <option value="USD">USD — US Dollar</option>
              <option value="CAD">CAD — Canadian Dollar</option>
              <option value="GBP">GBP — British Pound</option>
              <option value="EUR">EUR — Euro</option>
              <option value="AUD">AUD — Australian Dollar</option>
            </Select>
            <Input label="Card surcharge" type="number" min={0} max={10} step="0.01" suffix="%" value={draft.surcharge} onChange={(e) => setDraft((d) => ({ ...d, surcharge: e.target.value }))} hint="0 to disable." />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Currency" value={settings.currency} />
            <Field label="Card surcharge" value={settings.cardSurchargeBps > 0 ? `${(settings.cardSurchargeBps / 100).toFixed(2)}%` : "None"} />
          </div>
        )}
      </SettingsSection>
    </>
  );
}
