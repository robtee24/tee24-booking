"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, CalendarClock, PauseCircle, XCircle } from "lucide-react";
import { Button, Card, CardHeader, Input, Modal, Select, Textarea } from "@/components/ui";

export type PlanOption = { id: string; name: string; priceCents: number; billingCadence: string; description: string | null };

type Kind = "cancel" | "freeze" | "change-plan";

export function MembershipActions({
  canRequest,
  cancelPending,
  currentPlanId,
  plans,
  frozen,
}: {
  canRequest: boolean;
  cancelPending: boolean;
  currentPlanId: string | null;
  plans: PlanOption[];
  frozen: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState<Kind | null>(null);
  const [reason, setReason] = React.useState("");
  const [resumeDate, setResumeDate] = React.useState("");
  const [targetPlanId, setTargetPlanId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  function start(k: Kind) {
    setReason("");
    setResumeDate("");
    setTargetPlanId(plans.find((p) => p.id !== currentPlanId)?.id ?? "");
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
        body: JSON.stringify({ action: open, reason: reason.trim() || undefined, resumeDate: resumeDate || undefined, targetPlanId: targetPlanId || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setDone(open === "cancel" ? "We've received your cancellation request. A team member will confirm your end date shortly." : open === "freeze" ? "Freeze request sent. We'll confirm the dates and any freeze fee with you." : "Plan change request sent. We'll reach out to confirm pricing and timing.");
      setOpen(null);
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const otherPlans = plans.filter((p) => p.id !== currentPlanId);

  return (
    <>
      <Card>
        <CardHeader title="Manage membership" subtitle="Requests go to the front desk — nothing changes until a team member confirms." />
        {done && <div className="mt-3 rounded-apple-sm bg-apple-green/10 px-4 py-3 text-apple-sm text-apple-green">{done}</div>}
        {!canRequest && <p className="mt-3 text-apple-sm text-apple-text-tertiary">Membership changes are disabled while staff are viewing this account.</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <ActionTile icon={<PauseCircle className="h-5 w-5" />} title={frozen ? "Membership frozen" : "Request a freeze"} body={frozen ? "Your membership is currently on hold." : "Going away? Pause billing and access for a while."} onClick={() => start("freeze")} disabled={!canRequest || frozen} />
          <ActionTile icon={<ArrowRightLeft className="h-5 w-5" />} title="Change plan" body="Move up or down to a different plan." onClick={() => start("change-plan")} disabled={!canRequest || otherPlans.length === 0} />
          <ActionTile icon={<XCircle className="h-5 w-5" />} title={cancelPending ? "Cancellation pending" : "Request cancellation"} body={cancelPending ? "We've got your request and will be in touch." : "We'll confirm your final date and any notice period."} onClick={() => start("cancel")} disabled={!canRequest || cancelPending} danger />
        </div>
      </Card>

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

      <Modal
        open={open === "change-plan"}
        onClose={() => setOpen(null)}
        title="Change plan"
        description="Pick the plan you'd like to move to. We'll confirm pricing and when the change takes effect."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(null)}>Cancel</Button>
            <Button onClick={() => void submit()} loading={busy} disabled={!targetPlanId}>Send request</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Select label="New plan" value={targetPlanId} onChange={(e) => setTargetPlanId(e.target.value)}>
            <option value="">Choose a plan…</option>
            {otherPlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — ${(p.priceCents / 100).toFixed(2)}/{p.billingCadence.toLowerCase().replace("ly", "")}
              </option>
            ))}
          </Select>
          {targetPlanId && otherPlans.find((p) => p.id === targetPlanId)?.description && (
            <p className="text-apple-sm text-apple-text-secondary">{otherPlans.find((p) => p.id === targetPlanId)!.description}</p>
          )}
          <Textarea label="Anything we should know? (optional)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
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
