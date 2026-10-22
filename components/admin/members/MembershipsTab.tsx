"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Pause, Play, Plus, RotateCcw, Shuffle, XCircle } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, Money, Select, StatusBadge, Textarea, useToast } from "@/components/ui";
import { Checkbox, ErrorBanner, LoadingRows, api, errMsg, fmtDate, todayInput } from "./shared";

type Plan = { id: string; name: string; priceCents: number; signupFeeCents: number; billingCadence: string; productType: string; category: string | null; durationDays: number | null };
type Sub = {
  id: string; status: string; startDate: string; endDate: string | null; paidThroughDate: string | null; nextInvoiceDate: string | null; priceCents: number; billingCadence: string;
  cancelScheduledFor: string | null; cancellationReason: string | null; cancellationNotes: string | null; cancelledAt: string | null;
  freezeStartDate: string | null; freezeResumeDate: string | null; freezeReason: string | null; freezeFeeCents: number | null; autoRenew: boolean;
  plan: Plan;
};

const CURRENT = new Set(["ACTIVE", "PENDING", "FROZEN", "FREEZE_SCHEDULED", "CANCEL_SCHEDULED", "COMP"]);
const CANCEL_REASONS = ["Moving", "Too expensive", "Not using enough", "Injury / health", "Schedule change", "Dissatisfied", "Switching gyms", "Other"];

type ModalKind = null | { kind: "add" } | { kind: "cancel" | "freeze" | "extend" | "change"; sub: Sub };

export function MembershipsTab({ memberId }: { slug: string; memberId: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [data, setData] = React.useState<{ subscriptions: Sub[]; plans: Plan[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [modal, setModal] = React.useState<ModalKind>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setError(null);
    api<{ subscriptions: Sub[]; plans: Plan[] }>(`/api/admin/members/${memberId}/subscriptions`).then(setData).catch((e) => setError(errMsg(e)));
  }, [memberId]);
  React.useEffect(load, [load]);

  async function run(label: string, fn: () => Promise<unknown>, success: string) {
    setBusy(label);
    try {
      await fn();
      toast({ tone: "success", title: success });
      setModal(null);
      load();
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Action failed", description: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return <LoadingRows n={2} />;

  const current = data.subscriptions.filter((s) => CURRENT.has(s.status));
  const past = data.subscriptions.filter((s) => !CURRENT.has(s.status));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-apple-lg font-semibold text-apple-text">Memberships</h2>
        <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setModal({ kind: "add" })}>Add membership</Button>
      </div>

      {current.length === 0 ? (
        <EmptyState title="No active membership" description="Add a plan to start billing and grant door access." action={<Button onClick={() => setModal({ kind: "add" })}>Add membership</Button>} />
      ) : (
        current.map((s) => (
          <Card key={s.id}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-apple-base font-semibold text-apple-text">{s.plan.name}</span>
                  <StatusBadge status={s.status} size="sm" />
                  {!s.autoRenew && <Badge tone="muted" size="sm">No auto-renew</Badge>}
                </div>
                <div className="text-apple-sm text-apple-text-secondary"><Money cents={s.priceCents} /> / {s.billingCadence.toLowerCase()}</div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 pt-1 text-apple-xs text-apple-text-tertiary sm:grid-cols-4">
                  <Item label="Started" value={fmtDate(s.startDate)} />
                  <Item label="Paid through" value={fmtDate(s.paidThroughDate)} />
                  <Item label="Next invoice" value={fmtDate(s.nextInvoiceDate)} />
                  <Item label="Ends" value={fmtDate(s.endDate)} />
                </dl>
                {s.status === "CANCEL_SCHEDULED" && (
                  <p className="text-apple-xs text-apple-orange">Cancels {fmtDate(s.cancelScheduledFor)}{s.cancellationReason ? ` · ${s.cancellationReason}` : ""}</p>
                )}
                {(s.status === "FROZEN" || s.status === "FREEZE_SCHEDULED") && (
                  <p className="text-apple-xs text-apple-blue">
                    Frozen {fmtDate(s.freezeStartDate)} → {fmtDate(s.freezeResumeDate)}{s.freezeReason ? ` · ${s.freezeReason}` : ""}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {s.status === "CANCEL_SCHEDULED" ? (
                  <Button size="sm" variant="secondary" iconLeft={<RotateCcw className="h-3.5 w-3.5" />} loading={busy === "undo"} onClick={() => void run("undo", () => api(`/api/admin/memberships/${s.id}/undo-cancel`, { method: "POST" }), "Cancellation undone")}>
                    Undo cancel
                  </Button>
                ) : (
                  <Button size="sm" variant="danger" iconLeft={<XCircle className="h-3.5 w-3.5" />} onClick={() => setModal({ kind: "cancel", sub: s })}>Cancel</Button>
                )}
                {s.status === "FROZEN" || s.status === "FREEZE_SCHEDULED" ? (
                  <Button size="sm" variant="secondary" iconLeft={<Play className="h-3.5 w-3.5" />} loading={busy === "unfreeze"} onClick={() => void run("unfreeze", () => api(`/api/admin/memberships/${s.id}/freeze`, { method: "DELETE" }), "Membership resumed")}>
                    Unfreeze
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" iconLeft={<Pause className="h-3.5 w-3.5" />} onClick={() => setModal({ kind: "freeze", sub: s })}>Freeze</Button>
                )}
                <Button size="sm" variant="secondary" iconLeft={<CalendarPlus className="h-3.5 w-3.5" />} onClick={() => setModal({ kind: "extend", sub: s })}>Extend</Button>
                <Button size="sm" variant="secondary" iconLeft={<Shuffle className="h-3.5 w-3.5" />} onClick={() => setModal({ kind: "change", sub: s })}>Change plan</Button>
              </div>
            </div>
          </Card>
        ))
      )}

      {past.length > 0 && (
        <Card padded={false}>
          <div className="px-4 pt-4"><CardHeader title="Past memberships" /></div>
          <ul className="mt-2 divide-y divide-apple-divider">
            {past.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 px-4 py-3 text-apple-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="font-medium text-apple-text">{s.plan.name}</span>
                  <span className="ml-2 text-apple-xs text-apple-text-tertiary">{fmtDate(s.startDate)} → {fmtDate(s.cancelledAt ?? s.endDate)}</span>
                  {s.cancellationReason && <div className="text-apple-xs text-apple-text-tertiary">{s.cancellationReason}{s.cancellationNotes ? ` — ${s.cancellationNotes}` : ""}</div>}
                </div>
                <div className="flex items-center gap-3">
                  <Money cents={s.priceCents} className="text-apple-text-secondary" />
                  <StatusBadge status={s.status} size="sm" />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {modal?.kind === "add" && <AddMembershipModal plans={data.plans} busy={busy === "add"} onClose={() => setModal(null)} onSubmit={(body) => run("add", () => api(`/api/admin/members/${memberId}/subscriptions`, { method: "POST", json: body }), "Membership added")} />}
      {modal?.kind === "cancel" && <CancelModal sub={modal.sub} busy={busy === "cancel"} onClose={() => setModal(null)} onSubmit={(body) => run("cancel", () => api(`/api/admin/memberships/${modal.sub.id}/cancel`, { method: "POST", json: body }), "Cancellation recorded")} />}
      {modal?.kind === "freeze" && <FreezeModal sub={modal.sub} busy={busy === "freeze"} onClose={() => setModal(null)} onSubmit={(body) => run("freeze", () => api(`/api/admin/memberships/${modal.sub.id}/freeze`, { method: "POST", json: body }), "Freeze scheduled")} />}
      {modal?.kind === "extend" && <ExtendModal sub={modal.sub} busy={busy === "extend"} onClose={() => setModal(null)} onSubmit={(body) => run("extend", () => api(`/api/admin/memberships/${modal.sub.id}/extend`, { method: "POST", json: body }), "Membership extended")} />}
      {modal?.kind === "change" && <ChangePlanModal sub={modal.sub} plans={data.plans} busy={busy === "change"} onClose={() => setModal(null)} onSubmit={(body) => run("change", () => api(`/api/admin/memberships/${modal.sub.id}/change-plan`, { method: "POST", json: body }), "Plan changed")} />}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="uppercase tracking-wide">{label}</dt>
      <dd className="text-apple-sm text-apple-text">{value}</dd>
    </div>
  );
}

function Footer({ onClose, onSubmit, busy, label, danger, disabled }: { onClose: () => void; onSubmit: () => void; busy: boolean; label: string; danger?: boolean; disabled?: boolean }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant={danger ? "danger" : "primary"} onClick={onSubmit} loading={busy} disabled={disabled}>{label}</Button>
    </div>
  );
}

/* ---------------- Add membership ---------------- */
function AddMembershipModal({ plans, busy, onClose, onSubmit }: { plans: Plan[]; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const [planId, setPlanId] = React.useState(plans[0]?.id ?? "");
  const [startDate, setStartDate] = React.useState(todayInput());
  const [price, setPrice] = React.useState("");
  const [comp, setComp] = React.useState(false);
  const [activate, setActivate] = React.useState(true);
  const plan = plans.find((p) => p.id === planId);
  return (
    <Modal open onClose={onClose} title="Add membership" description="Starts the plan on this member's account." footer={<Footer onClose={onClose} busy={busy} label="Add membership" disabled={!planId} onSubmit={() => onSubmit({ planId, startDate, priceOverrideCents: price ? Math.round(Number(price) * 100) : undefined, comp, activate })} />}>
      <div className="space-y-3">
        <Select label="Plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {plans.length === 0 && <option value="">No plans available</option>}
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {(p.priceCents / 100).toFixed(2)} / {p.billingCadence.toLowerCase()}</option>)}
        </Select>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input label="Price override ($)" type="number" min={0} step="0.01" placeholder={plan ? (plan.priceCents / 100).toFixed(2) : ""} value={price} onChange={(e) => setPrice(e.target.value)} hint="Leave blank for plan price" disabled={comp} />
        </div>
        <Checkbox label="Complimentary (no billing)" checked={comp} onChange={setComp} hint="Requires the comp permission" />
        <Checkbox label="Activate immediately" checked={activate} onChange={setActivate} hint="Uncheck to leave Pending until first payment" />
        {plan?.signupFeeCents ? <p className="text-apple-xs text-apple-text-tertiary">Plan has a signup fee of ${(plan.signupFeeCents / 100).toFixed(2)}. Create it as a one-off charge from Payments if needed.</p> : null}
      </div>
    </Modal>
  );
}

/* ---------------- Cancel ---------------- */
function CancelModal({ sub, busy, onClose, onSubmit }: { sub: Sub; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const [timing, setTiming] = React.useState<"end_of_period" | "immediate" | "date">("end_of_period");
  const [date, setDate] = React.useState("");
  const [reason, setReason] = React.useState(CANCEL_REASONS[0]);
  const [notes, setNotes] = React.useState("");
  const [fee, setFee] = React.useState("");
  return (
    <Modal open onClose={onClose} title={`Cancel ${sub.plan.name}`} footer={<Footer danger onClose={onClose} busy={busy} label="Cancel membership" disabled={timing === "date" && !date} onSubmit={() => onSubmit({ timing, date: timing === "date" ? date : undefined, reason, notes: notes || undefined, cancelFeeCents: fee ? Math.round(Number(fee) * 100) : undefined })} />}>
      <div className="space-y-3">
        <Select label="When" value={timing} onChange={(e) => setTiming(e.target.value as any)}>
          <option value="end_of_period">End of paid period ({fmtDate(sub.paidThroughDate)})</option>
          <option value="date">Specific date</option>
          <option value="immediate">Immediately</option>
        </Select>
        {timing === "date" && <Input label="Cancel on" type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          {CANCEL_REASONS.map((r) => <option key={r}>{r}</option>)}
        </Select>
        <Textarea label="Notes (internal)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Input label="Cancellation fee ($)" type="number" min={0} step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} hint="Optional — creates a one-off invoice" />
      </div>
    </Modal>
  );
}

/* ---------------- Freeze ---------------- */
function FreezeModal({ sub, busy, onClose, onSubmit }: { sub: Sub; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const [startDate, setStartDate] = React.useState(todayInput());
  const [resumeDate, setResumeDate] = React.useState("");
  const [fee, setFee] = React.useState("");
  const [reason, setReason] = React.useState("");
  return (
    <Modal open onClose={onClose} title={`Freeze ${sub.plan.name}`} description="Billing and door access pause for the freeze window." footer={<Footer onClose={onClose} busy={busy} label="Freeze" disabled={!resumeDate} onSubmit={() => onSubmit({ startDate, resumeDate, feeCents: fee ? Math.round(Number(fee) * 100) : undefined, reason: reason || undefined })} />}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Freeze from" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input label="Resume on" type="date" value={resumeDate} min={startDate} onChange={(e) => setResumeDate(e.target.value)} />
        </div>
        <Input label="Freeze fee ($)" type="number" min={0} step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} hint="Optional one-off invoice" />
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Travel, injury…" />
      </div>
    </Modal>
  );
}

/* ---------------- Extend ---------------- */
function ExtendModal({ sub, busy, onClose, onSubmit }: { sub: Sub; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const [days, setDays] = React.useState("30");
  const [charge, setCharge] = React.useState("");
  const [reason, setReason] = React.useState("");
  return (
    <Modal open onClose={onClose} title={`Extend ${sub.plan.name}`} description={`Currently paid through ${fmtDate(sub.paidThroughDate)}.`} footer={<Footer onClose={onClose} busy={busy} label="Extend" disabled={!Number(days)} onSubmit={() => onSubmit({ days: Number(days), chargeCents: charge ? Math.round(Number(charge) * 100) : undefined, reason: reason || undefined })} />}>
      <div className="space-y-3">
        <Input label="Days" type="number" value={days} onChange={(e) => setDays(e.target.value)} hint="Negative values shorten the period" />
        <Input label="Charge ($)" type="number" min={0} step="0.01" value={charge} onChange={(e) => setCharge(e.target.value)} hint="Leave blank for a free extension" />
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}

/* ---------------- Change plan ---------------- */
function ChangePlanModal({ sub, plans, busy, onClose, onSubmit }: { sub: Sub; plans: Plan[]; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const others = plans.filter((p) => p.id !== sub.plan.id);
  const [newPlanId, setNewPlanId] = React.useState(others[0]?.id ?? "");
  const [proration, setProration] = React.useState<"PROSPECTIVE" | "RETROACTIVE" | "NONE">("PROSPECTIVE");
  const [invoiceProration, setInvoiceProration] = React.useState(true);
  return (
    <Modal open onClose={onClose} title="Change plan" description={`Switching from ${sub.plan.name}.`} footer={<Footer onClose={onClose} busy={busy} label="Change plan" disabled={!newPlanId} onSubmit={() => onSubmit({ newPlanId, proration, invoiceProration })} />}>
      <div className="space-y-3">
        <Select label="New plan" value={newPlanId} onChange={(e) => setNewPlanId(e.target.value)}>
          {others.map((p) => <option key={p.id} value={p.id}>{p.name} — {(p.priceCents / 100).toFixed(2)} / {p.billingCadence.toLowerCase()}</option>)}
        </Select>
        <Select label="Proration" value={proration} onChange={(e) => setProration(e.target.value as any)}>
          <option value="PROSPECTIVE">Prospective — new price from the next invoice</option>
          <option value="RETROACTIVE">Retroactive — prorate the current period</option>
          <option value="NONE">None</option>
        </Select>
        {proration !== "NONE" && <Checkbox label="Invoice the prorated difference now (if any)" checked={invoiceProration} onChange={setInvoiceProration} />}
      </div>
    </Modal>
  );
}
