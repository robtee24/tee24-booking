"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Modal, Money, Select, useToast } from "@/components/ui";
import { Plus, Play, CalendarClock } from "lucide-react";
import { MemberPicker, type MemberOption } from "./MemberPicker";

/** Header actions on the Recurring page: run the generator now + create an ad-hoc recurring charge. */
export function RecurringHeaderActions({ slug, members, squareConfigured, currency = "USD" }: { slug: string; members: MemberOption[]; squareConfigured: boolean; currency?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ memberId: "", name: "", amount: "", cadence: "MONTHLY", startDate: new Date().toISOString().slice(0, 10) });

  async function runNow() {
    setRunning(true);
    try {
      const res = await fetch(`/api/admin/billing/recurring?action=run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationSlug: slug }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Run failed");
      const r = json;
      toast({ tone: "success", title: "Billing run complete", description: `${r.created ?? 0} invoice(s) created · ${r.charged ?? 0} charged · ${r.failed ?? 0} failed · ${r.skipped ?? 0} skipped` });
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Billing run failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setRunning(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/billing/recurring`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationSlug: slug, memberId: form.memberId, name: form.name.trim(), amountCents: Math.round(Number(form.amount) * 100), cadence: form.cadence, startDate: form.startDate }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not create recurring charge");
      toast({ tone: "success", title: "Recurring charge created", description: `First invoice ${new Date(form.startDate).toLocaleDateString()}` });
      setOpen(false);
      setForm({ memberId: "", name: "", amount: "", cadence: "MONTHLY", startDate: new Date().toISOString().slice(0, 10) });
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Could not create", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  const valid = form.memberId && form.name.trim() && Number(form.amount) > 0 && form.startDate;

  return (
    <>
      <Button variant="secondary" iconLeft={<Play className="h-4 w-4" />} loading={running} onClick={runNow} title="Generate any invoices due today and charge cards on file">
        Run billing now
      </Button>
      <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New recurring charge</Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New recurring charge"
        description={`Bills a member a fixed amount on a schedule (e.g. locker rental). ${squareConfigured ? "Charged automatically to their default card on each billing date." : "Square isn't connected, so invoices will be created for manual payment."}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!valid}>Create</Button>
          </>
        }
      >
        <div className="space-y-3">
          <MemberPicker members={members} value={form.memberId} onChange={(id) => setForm((f) => ({ ...f, memberId: id }))} />
          <Input label="Name" placeholder="e.g. Locker rental" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label="Amount" type="number" min={0} step="0.01" prefix="$" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            <Select label="Every" value={form.cadence} onChange={(e) => setForm((f) => ({ ...f, cadence: e.target.value }))}>
              <option value="WEEKLY">Week</option>
              <option value="MONTHLY">Month</option>
              <option value="QUARTERLY">Quarter</option>
              <option value="YEARLY">Year</option>
            </Select>
            <Input label="First charge" type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </div>
          {Number(form.amount) > 0 && (
            <p className="text-apple-xs text-apple-text-tertiary">
              <Money cents={Math.round(Number(form.amount) * 100)} currency={currency} /> per {form.cadence.toLowerCase().replace("ly", "")} plus location tax, if any.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

/** Inline row controls: toggle auto-renew, change next invoice date, run just this subscription. */
export function SubscriptionRowActions({ slug, subscriptionId, autoRenew, nextInvoiceDate, status }: { slug: string; subscriptionId: string; autoRenew: boolean; nextInvoiceDate: string | null; status: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState(nextInvoiceDate ? nextInvoiceDate.slice(0, 10) : "");

  async function patch(body: Record<string, unknown>, title: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/billing/recurring`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId, ...body }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Update failed");
      toast({ tone: "success", title });
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Update failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function runOne() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/billing/recurring?action=run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationSlug: slug, subscriptionId }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Run failed");
      const r = json;
      toast({ tone: r.created ? "success" : "info", title: r.created ? "Invoice generated" : "Nothing due yet", description: r.charged ? "Charged to card on file" : r.failed ? "Charge failed — see Overdue" : undefined });
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Run failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  const live = status === "ACTIVE" || status === "CANCEL_SCHEDULED";

  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant="ghost" disabled={!live || busy} onClick={() => setOpen(true)} title="Change next invoice date" aria-label="Change next invoice date">
        <CalendarClock className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="ghost" disabled={!live || busy} onClick={runOne} title="Bill now if due" aria-label="Bill now">
        <Play className="h-4 w-4" />
      </Button>
      <Button size="sm" variant={autoRenew ? "secondary" : "ghost"} disabled={!live || busy} onClick={() => patch({ autoRenew: !autoRenew }, autoRenew ? "Auto-renew turned off" : "Auto-renew turned on")} className="min-w-[88px]">
        {autoRenew ? "Auto-renew" : "Manual"}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Next invoice date"
        description="Moves the next billing date without changing the paid-through date."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={busy} disabled={!date} onClick={() => patch({ nextInvoiceDate: date }, "Next invoice date updated")}>Save</Button>
          </>
        }
      >
        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Modal>
    </div>
  );
}
