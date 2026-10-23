"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, CalendarPlus, ExternalLink, FileCheck, Pause, Pencil, Play, Plus, RotateCcw, Shuffle, Users, XCircle } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, Money, Select, StatusBadge, Textarea, useToast } from "@/components/ui";
import { Checkbox, ErrorBanner, LoadingRows, api, errMsg, fmtDate, todayInput } from "./shared";
import { earlyCancelFeeDue, guestCentsFor, maxGuestsFor, membershipDisplayName } from "@/lib/membership-pricing";

type Plan = {
  id: string; name: string; priceCents: number; signupFeeCents: number; billingCadence: string; productType: string; category: string | null; durationDays: number | null;
  guestAddonCents: number | null; maxGuests: number; dayPassGuestPricing: unknown;
};
type Sub = {
  id: string; status: string; startDate: string; endDate: string | null; paidThroughDate: string | null; nextInvoiceDate: string | null; priceCents: number; billingCadence: string;
  cancelScheduledFor: string | null; cancellationReason: string | null; cancellationNotes: string | null; cancelledAt: string | null;
  freezeStartDate: string | null; freezeResumeDate: string | null; freezeReason: string | null; freezeFeeCents: number | null; autoRenew: boolean;
  guestCount: number; guestCents: number; promoDiscountId: string | null; commitmentMonths: number | null; commitmentEndsAt: string | null; earlyCancelFeeCents: number | null;
  plan: Plan;
};
type Upload = { id: string; kind: string; label: string | null; mimeType: string; sizeBytes: number; status: string; createdAt: string; reviewedAt: string | null; reviewNotes: string | null; discountId: string | null };

const subName = (s: Sub) => membershipDisplayName(s.plan.name, s.guestCount, s.plan.productType);

const CURRENT = new Set(["ACTIVE", "PENDING", "FROZEN", "FREEZE_SCHEDULED", "CANCEL_SCHEDULED", "COMP"]);
const CANCEL_REASONS = ["Moving", "Too expensive", "Not using enough", "Injury / health", "Schedule change", "Dissatisfied", "Switching gyms", "Other"];

type ModalKind = null | { kind: "add" } | { kind: "cancel" | "freeze" | "extend" | "change" | "edit"; sub: Sub };

export function MembershipsTab({ memberId }: { slug: string; memberId: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [data, setData] = React.useState<{ subscriptions: Sub[]; plans: Plan[] } | null>(null);
  const [uploads, setUploads] = React.useState<Upload[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [modal, setModal] = React.useState<ModalKind>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setError(null);
    api<{ subscriptions: Sub[]; plans: Plan[] }>(`/api/admin/members/${memberId}/subscriptions`).then(setData).catch((e) => setError(errMsg(e)));
    api<{ uploads: Upload[] }>(`/api/admin/members/${memberId}/uploads`).then((r) => setUploads(r.uploads)).catch(() => setUploads([]));
  }, [memberId]);
  React.useEffect(load, [load]);

  async function run(label: string, fn: () => Promise<unknown>, success: string | ((result: unknown) => { title: string; description?: string; tone?: "success" | "error" | "info" })) {
    setBusy(label);
    try {
      const result = await fn();
      if (typeof success === "string") toast({ tone: "success", title: success });
      else {
        const t = success(result);
        toast({ tone: t.tone ?? "success", title: t.title, description: t.description });
      }
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
                  <span className="text-apple-base font-semibold text-apple-text">{subName(s)}</span>
                  <StatusBadge status={s.status} size="sm" />
                  {!s.autoRenew && <Badge tone="muted" size="sm">No auto-renew</Badge>}
                  {s.guestCount > 0 && <Badge tone="info" size="sm"><Users className="mr-1 inline h-3 w-3" />{s.guestCount} guest{s.guestCount === 1 ? "" : "s"} per visit</Badge>}
                  {earlyCancelFeeDue(s) > 0 && <Badge tone="warn" size="sm">Min. term through {fmtDate(s.commitmentEndsAt)}</Badge>}
                </div>
                <div className="text-apple-sm text-apple-text-secondary">
                  <Money cents={s.priceCents} /> / {s.billingCadence.toLowerCase()}
                  {s.guestCents > 0 && <span className="text-apple-text-tertiary"> (incl. <Money cents={s.guestCents} /> guests)</span>}
                </div>
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
                <Button size="sm" variant="secondary" iconLeft={<Pencil className="h-3.5 w-3.5" />} onClick={() => setModal({ kind: "edit", sub: s })}>Edit</Button>
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
                  <span className="font-medium text-apple-text">{subName(s)}</span>
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

      {uploads.length > 0 && (
        <Card>
          <CardHeader title="ID verification" subtitle="Uploaded at signup for a promotional rate. Approve once you've checked it; reject to flag for follow-up." />
          <ul className="mt-3 divide-y divide-apple-divider">
            {uploads.map((u) => (
              <li key={u.id} className="flex flex-col gap-2 py-3 text-apple-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileCheck className="h-4 w-4 text-apple-text-tertiary" />
                    <span className="font-medium text-apple-text">{u.label ?? "ID upload"}</span>
                    <StatusBadge status={u.status} size="sm" />
                  </div>
                  <div className="text-apple-xs text-apple-text-tertiary">
                    {u.mimeType.replace("image/", "").replace("application/", "").toUpperCase()} · {(u.sizeBytes / 1024).toFixed(0)} KB · uploaded {fmtDate(u.createdAt)}
                    {u.reviewedAt ? ` · reviewed ${fmtDate(u.reviewedAt)}` : ""}
                    {u.reviewNotes ? ` — ${u.reviewNotes}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={`/api/admin/members/${memberId}/uploads/${u.id}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-apple-sm border border-apple-border px-3 text-apple-sm text-apple-text hover:bg-apple-fill-secondary">
                    <ExternalLink className="h-3.5 w-3.5" /> View
                  </a>
                  {u.status === "PENDING" && (
                    <>
                      <Button size="sm" iconLeft={<BadgeCheck className="h-3.5 w-3.5" />} loading={busy === `approve-${u.id}`} onClick={() => void run(`approve-${u.id}`, () => api(`/api/admin/members/${memberId}/uploads/${u.id}`, { method: "PATCH", json: { status: "APPROVED" } }), "ID approved")}>Approve</Button>
                      <Button size="sm" variant="danger" loading={busy === `reject-${u.id}`} onClick={() => { const notes = window.prompt("Why is this ID being rejected? (shown internally)") ?? ""; void run(`reject-${u.id}`, () => api(`/api/admin/members/${memberId}/uploads/${u.id}`, { method: "PATCH", json: { status: "REJECTED", notes } }), "ID rejected"); }}>Reject</Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {modal?.kind === "add" && <AddMembershipModal plans={data.plans} busy={busy === "add"} onClose={() => setModal(null)} onSubmit={(body) => run("add", () => api(`/api/admin/members/${memberId}/subscriptions`, { method: "POST", json: body }), "Membership added")} />}
      {modal?.kind === "edit" && <EditModal sub={modal.sub} busy={busy === "edit"} onClose={() => setModal(null)} onSubmit={(body) => run("edit", () => api(`/api/admin/memberships/${modal.sub.id}/edit`, { method: "POST", json: body }), "Membership updated")} />}
      {modal?.kind === "cancel" && (
        <CancelModal
          sub={modal.sub}
          busy={busy === "cancel"}
          onClose={() => setModal(null)}
          onSubmit={(body) =>
            run(
              "cancel",
              () => api(`/api/admin/memberships/${modal.sub.id}/cancel`, { method: "POST", json: body }),
              (r) => {
                const fee = (r as { earlyCancelFee?: { feeCents: number; charged: boolean; failureReason: string | null; invoiceNumber: number } | null })?.earlyCancelFee;
                if (!fee) return { title: "Cancellation recorded" };
                return fee.charged
                  ? { title: "Cancellation recorded", description: `Early-cancellation fee of $${(fee.feeCents / 100).toFixed(2)} charged (invoice #${fee.invoiceNumber}).` }
                  : { tone: "error", title: "Cancelled — fee not collected", description: `Invoice #${fee.invoiceNumber} for $${(fee.feeCents / 100).toFixed(2)} is open: ${fee.failureReason ?? "no card on file"}.` };
              },
            )
          }
        />
      )}
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
function AddMembershipModal({ plans, busy, onClose, onSubmit }: { plans: Plan[]; busy: boolean; onClose: () => void; onSubmit: (b: Record<string, unknown>) => void }) {
  const [planId, setPlanId] = React.useState(plans[0]?.id ?? "");
  const [startDate, setStartDate] = React.useState(todayInput());
  const [price, setPrice] = React.useState("");
  const [comp, setComp] = React.useState(false);
  const [activate, setActivate] = React.useState(true);
  const [guests, setGuests] = React.useState(0);
  const plan = plans.find((p) => p.id === planId);
  const maxG = plan ? maxGuestsFor(plan) : 0;
  const guestCount = Math.min(guests, maxG);
  const computed = plan ? plan.priceCents + guestCentsFor(plan, guestCount) : 0;
  return (
    <Modal open onClose={onClose} title="Add membership" description="Starts the plan on this member's account." footer={<Footer onClose={onClose} busy={busy} label="Add membership" disabled={!planId} onSubmit={() => onSubmit({ planId, startDate, guestCount, priceOverrideCents: price ? Math.round(Number(price) * 100) : undefined, comp, activate })} />}>
      <div className="space-y-3">
        <Select label="Plan" value={planId} onChange={(e) => { setPlanId(e.target.value); setGuests(0); }}>
          {plans.length === 0 && <option value="">No plans available</option>}
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {(p.priceCents / 100).toFixed(2)} / {p.billingCadence.toLowerCase()}</option>)}
        </Select>
        {plan && maxG > 0 && <GuestSelect plan={plan} value={guestCount} onChange={setGuests} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input label="Price override ($)" type="number" min={0} step="0.01" placeholder={plan ? (computed / 100).toFixed(2) : ""} value={price} onChange={(e) => setPrice(e.target.value)} hint={guestCount > 0 ? `Leave blank for plan + guests ($${(computed / 100).toFixed(2)})` : "Leave blank for plan price"} disabled={comp} />
        </div>
        <Checkbox label="Complimentary (no billing)" checked={comp} onChange={setComp} hint="Requires the comp permission" />
        <Checkbox label="Activate immediately" checked={activate} onChange={setActivate} hint="Uncheck to leave Pending until first payment" />
        {plan?.signupFeeCents ? <p className="text-apple-xs text-apple-text-tertiary">Plan has a signup fee of ${(plan.signupFeeCents / 100).toFixed(2)}. Create it as a one-off charge from Payments if needed.</p> : null}
      </div>
    </Modal>
  );
}

/* ---------------- Cancel ---------------- */
function CancelModal({ sub, busy, onClose, onSubmit }: { sub: Sub; busy: boolean; onClose: () => void; onSubmit: (b: Record<string, unknown>) => void }) {
  const [timing, setTiming] = React.useState<"end_of_period" | "immediate" | "date">("end_of_period");
  const [date, setDate] = React.useState("");
  const [reason, setReason] = React.useState(CANCEL_REASONS[0]);
  const [notes, setNotes] = React.useState("");
  const [fee, setFee] = React.useState("");
  const [waive, setWaive] = React.useState(false);
  const earlyFee = earlyCancelFeeDue(sub);
  return (
    <Modal open onClose={onClose} title={`Cancel ${subName(sub)}`} footer={<Footer danger onClose={onClose} busy={busy} label="Cancel membership" disabled={timing === "date" && !date} onSubmit={() => onSubmit({ timing, date: timing === "date" ? date : undefined, reason, notes: notes || undefined, cancelFeeCents: fee ? Math.round(Number(fee) * 100) : undefined, waiveEarlyCancelFee: waive })} />}>
      <div className="space-y-3">
        {earlyFee > 0 && (
          <div className="rounded-apple border border-apple-orange/40 bg-apple-orange/5 p-3 text-apple-sm text-apple-text">
            <p className="font-medium text-apple-orange">Inside promotional minimum term</p>
            <p className="mt-0.5 text-apple-xs text-apple-text-secondary">
              This member signed up with a {sub.commitmentMonths}-month minimum (through {fmtDate(sub.commitmentEndsAt)}). Cancelling now charges the <Money cents={earlyFee} /> promotional discount back to their card on file, as they agreed at signup.
            </p>
            <div className="mt-2"><Checkbox label="Waive the early-cancellation fee" checked={waive} onChange={setWaive} /></div>
          </div>
        )}
        <Select label="When" value={timing} onChange={(e) => setTiming(e.target.value as never)}>
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
function FreezeModal({ sub, busy, onClose, onSubmit }: { sub: Sub; busy: boolean; onClose: () => void; onSubmit: (b: Record<string, unknown>) => void }) {
  const [startDate, setStartDate] = React.useState(todayInput());
  const [resumeDate, setResumeDate] = React.useState("");
  const [fee, setFee] = React.useState("");
  const [reason, setReason] = React.useState("");
  return (
    <Modal open onClose={onClose} title={`Freeze ${subName(sub)}`} description="Billing and door access pause for the freeze window." footer={<Footer onClose={onClose} busy={busy} label="Freeze" disabled={!resumeDate} onSubmit={() => onSubmit({ startDate, resumeDate, feeCents: fee ? Math.round(Number(fee) * 100) : undefined, reason: reason || undefined })} />}>
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
function ExtendModal({ sub, busy, onClose, onSubmit }: { sub: Sub; busy: boolean; onClose: () => void; onSubmit: (b: Record<string, unknown>) => void }) {
  const [days, setDays] = React.useState("30");
  const [charge, setCharge] = React.useState("");
  const [reason, setReason] = React.useState("");
  return (
    <Modal open onClose={onClose} title={`Extend ${subName(sub)}`} description={`Currently paid through ${fmtDate(sub.paidThroughDate)}.`} footer={<Footer onClose={onClose} busy={busy} label="Extend" disabled={!Number(days)} onSubmit={() => onSubmit({ days: Number(days), chargeCents: charge ? Math.round(Number(charge) * 100) : undefined, reason: reason || undefined })} />}>
      <div className="space-y-3">
        <Input label="Days" type="number" value={days} onChange={(e) => setDays(e.target.value)} hint="Negative values shorten the period" />
        <Input label="Charge ($)" type="number" min={0} step="0.01" value={charge} onChange={(e) => setCharge(e.target.value)} hint="Leave blank for a free extension" />
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}

/* ---------------- Change plan ---------------- */
function ChangePlanModal({ sub, plans, busy, onClose, onSubmit }: { sub: Sub; plans: Plan[]; busy: boolean; onClose: () => void; onSubmit: (b: Record<string, unknown>) => void }) {
  const others = plans.filter((p) => p.id !== sub.plan.id);
  const [newPlanId, setNewPlanId] = React.useState(others[0]?.id ?? "");
  const [proration, setProration] = React.useState<"PROSPECTIVE" | "RETROACTIVE" | "NONE">("PROSPECTIVE");
  const [invoiceProration, setInvoiceProration] = React.useState(true);
  const [guests, setGuests] = React.useState(sub.guestCount);
  const [price, setPrice] = React.useState("");
  const newPlan = others.find((p) => p.id === newPlanId);
  const maxG = newPlan ? maxGuestsFor(newPlan) : 0;
  const guestCount = Math.min(guests, maxG);
  const computed = newPlan ? newPlan.priceCents + guestCentsFor(newPlan, guestCount) : 0;
  return (
    <Modal open onClose={onClose} title="Change plan" description={`Switching from ${subName(sub)} (${(sub.priceCents / 100).toFixed(2)} / ${sub.billingCadence.toLowerCase()}).`} footer={<Footer onClose={onClose} busy={busy} label="Change plan" disabled={!newPlanId} onSubmit={() => onSubmit({ newPlanId, proration, invoiceProration, guestCount, priceOverrideCents: price ? Math.round(Number(price) * 100) : undefined })} />}>
      <div className="space-y-3">
        <Select label="New plan" value={newPlanId} onChange={(e) => setNewPlanId(e.target.value)}>
          {others.map((p) => <option key={p.id} value={p.id}>{p.name} — {(p.priceCents / 100).toFixed(2)} / {p.billingCadence.toLowerCase()}</option>)}
        </Select>
        {newPlan && maxG > 0 && <GuestSelect plan={newPlan} value={guestCount} onChange={setGuests} />}
        {newPlan && (
          <div className="rounded-apple bg-apple-fill-secondary p-3 text-apple-sm">
            <div className="flex items-center justify-between"><span className="text-apple-text-secondary">New membership</span><span className="font-medium text-apple-text">{membershipDisplayName(newPlan.name, guestCount, newPlan.productType)}</span></div>
            <div className="mt-1 flex items-center justify-between"><span className="text-apple-text-secondary">New price</span><span className="font-medium text-apple-text"><Money cents={price ? Math.round(Number(price) * 100) : computed} /> / {newPlan.billingCadence.toLowerCase()}</span></div>
          </div>
        )}
        <Input label="Price override ($)" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={(computed / 100).toFixed(2)} hint="Leave blank for plan price + guests. Use this to keep a legacy or discounted rate." />
        <Select label="Proration" value={proration} onChange={(e) => setProration(e.target.value as never)}>
          <option value="PROSPECTIVE">Prospective — new price from the next invoice</option>
          <option value="RETROACTIVE">Retroactive — prorate the current period</option>
          <option value="NONE">None</option>
        </Select>
        {proration !== "NONE" && <Checkbox label="Invoice the prorated difference now (if any)" checked={invoiceProration} onChange={setInvoiceProration} />}
      </div>
    </Modal>
  );
}

/* ---------------- Guests ---------------- */
function GuestSelect({ plan, value, onChange }: { plan: Plan; value: number; onChange: (n: number) => void }) {
  const max = maxGuestsFor(plan);
  const isDayPass = plan.productType === "DAY_PASS";
  return (
    <Select label={isDayPass ? "Guests today" : "Guests on every visit"} value={String(value)} onChange={(e) => onChange(Number(e.target.value))} hint={isDayPass ? "Tiered guest pricing from the plan." : `Each guest adds $${((plan.guestAddonCents ?? 0) / 100).toFixed(2)} per ${plan.billingCadence.toLowerCase().replace("ly", "")}.`}>
      {Array.from({ length: max + 1 }, (_, n) => (
        <option key={n} value={n}>
          {n === 0 ? "No guests" : n === 1 ? "1 guest" : `${n} guests`}{n > 0 ? ` (+$${(guestCentsFor(plan, n) / 100).toFixed(2)})` : ""}
        </option>
      ))}
    </Select>
  );
}

/* ---------------- Edit membership ---------------- */
function EditModal({ sub, busy, onClose, onSubmit }: { sub: Sub; busy: boolean; onClose: () => void; onSubmit: (b: Record<string, unknown>) => void }) {
  const max = maxGuestsFor(sub.plan);
  const [guests, setGuests] = React.useState(sub.guestCount);
  const [price, setPrice] = React.useState("");
  const [autoRenew, setAutoRenew] = React.useState(sub.autoRenew);
  const [clearCommitment, setClearCommitment] = React.useState(false);
  const basePrice = sub.priceCents - sub.guestCents;
  const recomputed = Math.max(0, basePrice + guestCentsFor(sub.plan, guests));
  const guestsChanged = guests !== sub.guestCount;
  const hasCommitment = !!sub.commitmentEndsAt;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${subName(sub)}`}
      description="Adjust guests, price or auto-renew without changing the plan. Takes effect on the next invoice."
      footer={<Footer onClose={onClose} busy={busy} label="Save" onSubmit={() => onSubmit({ guestCount: guestsChanged ? guests : undefined, priceCents: price ? Math.round(Number(price) * 100) : undefined, autoRenew: autoRenew !== sub.autoRenew ? autoRenew : undefined, clearCommitment })} />}
    >
      <div className="space-y-3">
        {max > 0 ? (
          <GuestSelect plan={sub.plan} value={Math.min(guests, max)} onChange={setGuests} />
        ) : (
          sub.guestCount > 0 && <p className="text-apple-xs text-apple-text-tertiary">This plan no longer offers guests; the current {sub.guestCount} guest{sub.guestCount === 1 ? "" : "s"} stay until changed via a plan change.</p>
        )}
        <Input
          label="Price per period ($)"
          type="number"
          min={0}
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder={(recomputed / 100).toFixed(2)}
          hint={guestsChanged ? `Leave blank to keep the member's base rate ($${(basePrice / 100).toFixed(2)}) and update the guest portion → $${(recomputed / 100).toFixed(2)}.` : `Currently $${(sub.priceCents / 100).toFixed(2)}. Leave blank to keep.`}
        />
        <Checkbox label="Auto-renew" checked={autoRenew} onChange={setAutoRenew} hint="When off, the membership ends at the paid-through date instead of invoicing again." />
        {hasCommitment && (
          <Checkbox label="Clear promotional minimum term" checked={clearCommitment} onChange={setClearCommitment} hint={`Minimum term runs through ${fmtDate(sub.commitmentEndsAt)}${sub.earlyCancelFeeCents ? ` with a $${(sub.earlyCancelFeeCents / 100).toFixed(2)} early-cancellation fee` : ""}. Clearing it waives the fee.`} />
        )}
      </div>
    </Modal>
  );
}
