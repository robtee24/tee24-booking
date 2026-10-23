"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, CalendarClock, PauseCircle, Users, XCircle } from "lucide-react";
import { Button, Card, CardHeader, Input, Modal, Textarea } from "@/components/ui";
import { ChangePlanModal } from "./ChangePlanModal";
import type { PendingChangeView } from "@/services/portal-membership.service";

export type PlanOption = { id: string; name: string; priceCents: number; billingCadence: string; description: string | null };

type Kind = "cancel" | "freeze";
type SelfServe = { focus: "plan" | "guests"; planId: string; guestCount: number };

export function MembershipActions({
  canRequest,
  cancelPending,
  currentPlanId,
  currentGuestCount,
  maxGuests,
  frozen,
  recurring,
}: {
  canRequest: boolean;
  cancelPending: boolean;
  currentPlanId: string | null;
  currentGuestCount: number;
  maxGuests: number;
  frozen: boolean;
  recurring: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState<Kind | null>(null);
  const [selfServe, setSelfServe] = React.useState<SelfServe | null>(null);
  const [reason, setReason] = React.useState("");
  const [resumeDate, setResumeDate] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  function start(k: Kind) {
    setReason("");
    setResumeDate("");
    setError(null);
    setOpen(k);
  }

  async function submit() {
    if (!open) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: open, reason: reason.trim() || undefined, resumeDate: resumeDate || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setDone(open === "cancel" ? "We've received your cancellation request. A team member will confirm your end date shortly." : "Freeze request sent. We'll confirm the dates and any freeze fee with you.");
      setOpen(null);
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const canSelfServe = canRequest && recurring && !!currentPlanId;
  const guestTitle = currentGuestCount > 0 ? `${currentGuestCount} guest${currentGuestCount === 1 ? "" : "s"} per visit` : "Add a guest";
  const guestBody = currentGuestCount > 0 ? "Add another guest or go back to member-only." : "Bring a complimentary guest on every visit for $25/mo.";

  return (
    <>
      <Card>
        <CardHeader title="Manage membership" subtitle="Plan and guest changes apply instantly (upgrades) or at your next renewal (downgrades). Freezes and cancellations are confirmed by the front desk." />
        {done && <div className="mt-3 rounded-apple-sm bg-apple-green/10 px-4 py-3 text-apple-sm text-apple-green">{done}</div>}
        {!canRequest && <p className="mt-3 text-apple-sm text-apple-text-tertiary">Membership changes are disabled while staff are viewing this account.</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionTile icon={<ArrowRightLeft className="h-5 w-5" />} title="Change plan" body="Move up or down between memberships." onClick={() => currentPlanId && setSelfServe({ focus: "plan", planId: currentPlanId, guestCount: currentGuestCount })} disabled={!canSelfServe} />
          <ActionTile icon={<Users className="h-5 w-5" />} title={guestTitle} body={maxGuests > 0 ? guestBody : "Your plan doesn't include guest add-ons."} onClick={() => currentPlanId && setSelfServe({ focus: "guests", planId: currentPlanId, guestCount: Math.min(maxGuests, currentGuestCount > 0 ? currentGuestCount : 1) })} disabled={!canSelfServe || maxGuests === 0} />
          <ActionTile icon={<PauseCircle className="h-5 w-5" />} title={frozen ? "Membership frozen" : "Request a freeze"} body={frozen ? "Your membership is currently on hold." : "Going away? Pause billing and access for a while."} onClick={() => start("freeze")} disabled={!canRequest || frozen} />
          <ActionTile icon={<XCircle className="h-5 w-5" />} title={cancelPending ? "Cancellation pending" : "Request cancellation"} body={cancelPending ? "We've got your request and will be in touch." : "We'll confirm your final date and any notice period."} onClick={() => start("cancel")} disabled={!canRequest || cancelPending} danger />
        </div>
      </Card>

      {selfServe && <ChangePlanModal open onClose={() => setSelfServe(null)} initial={{ planId: selfServe.planId, guestCount: selfServe.guestCount }} focus={selfServe.focus} />}

      <Modal
        open={open === "cancel"}
        onClose={() => setOpen(null)}
        title="Request cancellation"
        description="Tell us why you're leaving (optional). A team member will confirm your end date based on your plan's notice period."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(null)}>Keep my membership</Button>
            <Button variant="danger" onClick={() => void submit()} loading={busy}>Send request</Button>
          </>
        }
      >
        <Textarea label="Reason (optional)" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Moving, cost, not using it enough…" />
        {error && <p className="mt-2 text-apple-sm text-apple-red">{error}</p>}
      </Modal>

      <Modal
        open={open === "freeze"}
        onClose={() => setOpen(null)}
        title="Request a freeze"
        description="Freezes pause billing and door access. Some plans charge a small monthly freeze fee — we'll confirm before anything changes."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(null)}>Cancel</Button>
            <Button onClick={() => void submit()} loading={busy}>Send request</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="Resume on (optional)" type="date" value={resumeDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setResumeDate(e.target.value)} hint="Leave blank if you're not sure yet." />
          <Textarea label="Reason (optional)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Travel, injury, busy season…" />
          {error && <p className="text-apple-sm text-apple-red">{error}</p>}
        </div>
      </Modal>

    </>
  );
}

function ActionTile({ icon, title, body, onClick, disabled, danger }: { icon: React.ReactNode; title: string; body: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-start gap-2 rounded-apple-sm border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${danger ? "border-apple-red/20 hover:bg-apple-red/5" : "border-apple-border hover:bg-apple-fill-secondary/60"}`}
    >
      <span className={danger ? "text-apple-red" : "text-apple-blue"}>{icon}</span>
      <span className="text-apple-sm font-semibold text-apple-text">{title}</span>
      <span className="text-apple-xs text-apple-text-secondary">{body}</span>
    </button>
  );
}

export function RenewBanner({ payToken, totalCents, dueDate, status }: { payToken: string | null; totalCents: number; dueDate: string; status: string }) {
  const overdue = status === "PAST_DUE" || status === "FAILED";
  return (
    <div className={`flex flex-col gap-3 rounded-apple border p-4 sm:flex-row sm:items-center sm:justify-between ${overdue ? "border-apple-red/30 bg-apple-red/5" : "border-apple-blue/30 bg-apple-blue/5"}`}>
      <div className="flex items-start gap-3">
        <CalendarClock className={`mt-0.5 h-5 w-5 ${overdue ? "text-apple-red" : "text-apple-blue"}`} />
        <div>
          <div className="text-apple-sm font-semibold text-apple-text">
            {overdue ? "Payment needed" : "Next payment"} · ${(totalCents / 100).toFixed(2)}
          </div>
          <div className="text-apple-xs text-apple-text-secondary">
            {overdue ? `Was due ${new Date(dueDate).toLocaleDateString()}. Pay now to keep your access active.` : `Due ${new Date(dueDate).toLocaleDateString()}. We'll charge your card on file automatically.`}
          </div>
        </div>
      </div>
      {payToken && (
        <Link href={`/pay/${encodeURIComponent(payToken)}`} className={`inline-flex shrink-0 items-center justify-center rounded-apple-pill px-4 py-2 text-apple-sm font-semibold text-white ${overdue ? "bg-apple-red hover:bg-apple-red/90" : "bg-apple-blue hover:bg-apple-blue/90"}`}>
          {overdue ? "Pay now" : "Pay early / renew"}
        </Link>
      )}
    </div>
  );
}

export function PendingChangeBanner({ pending, canCancel }: { pending: PendingChangeView; canCancel: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/membership/change", { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't cancel");
    } finally {
      setBusy(false);
    }
  }
  const date = new Date(pending.effectiveAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div className="flex flex-col gap-3 rounded-apple border border-apple-orange/30 bg-apple-orange/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 h-5 w-5 text-apple-orange" />
        <div>
          <div className="text-apple-sm font-semibold text-apple-text">Scheduled change · {pending.displayName}</div>
          <div className="text-apple-xs text-apple-text-secondary">Starts {date} at ${(pending.priceCents / 100).toFixed(2)} per period. Your current plan stays in place until then.</div>
          {error && <div className="mt-1 text-apple-xs text-apple-red">{error}</div>}
        </div>
      </div>
      {canCancel && <Button variant="secondary" size="sm" onClick={() => void cancel()} loading={busy}>Keep my current plan</Button>}
    </div>
  );
}
