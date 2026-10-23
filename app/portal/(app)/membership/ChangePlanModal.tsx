"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CreditCard, Users } from "lucide-react";
import { Badge, Button, Modal } from "@/components/ui";
import type { ChangePreview, SelfServicePlan } from "@/services/portal-membership.service";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const cadence = (c: string) => c.toLowerCase().replace("ly", "");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

type Props = {
  open: boolean;
  onClose: () => void;
  /** Where to start the selector: current plan + guests, or current plan + one more guest. */
  initial: { planId: string; guestCount: number };
  focus: "plan" | "guests";
};

/**
 * Self-service plan / guest change with a live price preview.
 * Upgrades charge the prorated difference today; downgrades apply at renewal.
 * When the server says `mode: "request"` (frozen, migration, etc.) the same
 * selection is sent to the front desk as a request instead.
 */
export function ChangePlanModal({ open, onClose, initial, focus }: Props) {
  const router = useRouter();
  const [planId, setPlanId] = React.useState(initial.planId);
  const [guestCount, setGuestCount] = React.useState(initial.guestCount);
  const [plans, setPlans] = React.useState<SelfServicePlan[]>([]);
  const [preview, setPreview] = React.useState<ChangePreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPlanId(initial.planId);
    setGuestCount(initial.guestCount);
    setError(null);
    setDone(null);
  }, [open, initial.planId, initial.guestCount]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/portal/membership/change?planId=${encodeURIComponent(planId)}&guestCount=${guestCount}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        return j as { preview: ChangePreview; plans: SelfServicePlan[] };
      })
      .then((j) => {
        if (cancelled) return;
        setPreview(j.preview);
        setPlans(j.plans);
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load pricing"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, planId, guestCount]);

  const plan = plans.find((p) => p.id === planId) ?? null;
  const maxGuests = plan?.maxGuests ?? 0;
  React.useEffect(() => {
    if (plan && guestCount > plan.maxGuests) setGuestCount(plan.maxGuests);
  }, [plan, guestCount]);

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      if (preview.mode === "request") {
        const res = await fetch("/api/portal/membership", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "change-plan", targetPlanId: planId, reason: `Requested ${preview.target.displayName} (${guestCount} guest${guestCount === 1 ? "" : "s"}) from the clubhouse.` }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
        setDone("Request sent. A team member will confirm the change with you shortly.");
      } else {
        const res = await fetch("/api/portal/membership/change", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, guestCount }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
        const r = j.result as { applied: "now" | "scheduled"; displayName: string; chargedCents?: number; effectiveAt?: string };
        setDone(
          r.applied === "now"
            ? `You're now on ${r.displayName}.${r.chargedCents ? ` We charged ${money(r.chargedCents)} to your card for the rest of this period.` : ""}`
            : `Done — you'll move to ${r.displayName} on ${when(r.effectiveAt ?? null)}. Until then nothing changes.`,
        );
      }
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const unchanged = preview?.kind === "none";
  const needsCard = Boolean(preview && preview.mode === "self-service" && preview.requiresCard && !preview.hasCard);
  const title = focus === "guests" ? "Guests on your membership" : "Change plan";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={focus === "guests" ? "Bring a complimentary guest on every visit. Each guest adds to your monthly price." : "Pick the plan you'd like. Upgrades start right away; downgrades start at your next renewal."}
      wide
      footer={
        done ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void confirm()} loading={busy} disabled={loading || !preview || unchanged || needsCard || !!error}>
              {preview?.mode === "request" ? "Send request" : preview?.kind === "upgrade" && preview.dueTodayCents > 0 ? `Pay ${money(preview.dueTodayCents)} & switch` : preview?.kind === "downgrade" ? "Schedule change" : "Confirm"}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex items-start gap-3 rounded-apple-sm bg-apple-green/10 px-4 py-3 text-apple-sm text-apple-green">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{done}</span>
        </div>
      ) : (
        <div className="space-y-5">
          {focus === "plan" && (
            <section>
              <h3 className="mb-2 text-apple-xs font-semibold uppercase tracking-wide text-apple-text-tertiary">Plan</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {plans.map((p) => {
                  const selected = p.id === planId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlanId(p.id)}
                      className={`flex flex-col items-start gap-1 rounded-apple-sm border p-3 text-left transition-colors ${selected ? "border-apple-blue bg-apple-blue/5 ring-1 ring-apple-blue" : "border-apple-border hover:bg-apple-fill-secondary/60"}`}
                      aria-pressed={selected}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="text-apple-sm font-semibold text-apple-text">{p.name}</span>
                        <span className="text-apple-sm text-apple-text">
                          {money(p.netPriceCents)}<span className="text-apple-text-tertiary">/{cadence(p.billingCadence)}</span>
                        </span>
                      </div>
                      {p.description && <span className="text-apple-xs text-apple-text-secondary">{p.description}</span>}
                      {p.id === preview?.current.planId && <Badge tone="muted" size="sm">Current</Badge>}
                    </button>
                  );
                })}
                {!plans.length && !loading && <p className="text-apple-sm text-apple-text-tertiary">No other plans are available online right now.</p>}
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-apple-xs font-semibold uppercase tracking-wide text-apple-text-tertiary">Complimentary guests on every visit</h3>
            {maxGuests > 0 ? (
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: maxGuests + 1 }, (_, n) => n).map((n) => {
                  const selected = n === guestCount;
                  const add = plan?.guestAddonCents ?? 0;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setGuestCount(n)}
                      aria-pressed={selected}
                      className={`flex min-w-[7.5rem] flex-col items-start rounded-apple-sm border px-3 py-2 text-left transition-colors ${selected ? "border-apple-blue bg-apple-blue/5 ring-1 ring-apple-blue" : "border-apple-border hover:bg-apple-fill-secondary/60"}`}
                    >
                      <span className="flex items-center gap-1.5 text-apple-sm font-semibold text-apple-text">
                        <Users className="h-3.5 w-3.5" />
                        {n === 0 ? "Just me" : `${n} guest${n === 1 ? "" : "s"}`}
                      </span>
                      <span className="text-apple-xs text-apple-text-secondary">{n === 0 ? "Member only" : `+${money(add * n)}/${cadence(plan?.billingCadence ?? "MONTHLY")}`}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-apple-sm text-apple-text-tertiary">{plan ? `${plan.name} doesn't include guest add-ons. Guests can pay the day-of guest fee at the bay.` : "Loading…"}</p>
            )}
          </section>

          <section className="rounded-apple-sm border border-apple-border bg-apple-fill-secondary/40 p-4 text-apple-sm">
            {loading && !preview ? (
              <p className="text-apple-text-tertiary">Calculating…</p>
            ) : preview ? (
              <dl className="space-y-2">
                <Row label="Now">
                  {preview.current.displayName} · {money(preview.current.netPriceCents)}/{cadence(preview.current.billingCadence)}
                </Row>
                <Row label="New">
                  <span className="font-semibold text-apple-text">{preview.target.displayName}</span> · {money(preview.target.netPriceCents)}/{cadence(preview.target.billingCadence)}
                  {preview.discount && <span className="ml-2 text-apple-green">({preview.discount.label} applied)</span>}
                </Row>
                {unchanged ? (
                  <p className="pt-1 text-apple-text-tertiary">That&apos;s your current plan — pick something different to make a change.</p>
                ) : preview.mode === "request" ? (
                  <p className="pt-1 text-apple-orange">{preview.requestReason}</p>
                ) : preview.kind === "upgrade" ? (
                  <>
                    <Row label="Due today">
                      <span className="font-semibold text-apple-text">{money(preview.dueTodayCents)}</span>
                      {preview.proration && <span className="text-apple-text-tertiary"> · prorated for the {preview.proration.remainingDays} days left in your period (through {when(preview.proration.periodEnd)})</span>}
                      {!preview.proration && <span className="text-apple-text-tertiary"> · no paid period on file</span>}
                    </Row>
                    <p className="pt-1 text-apple-text-secondary">Your new plan starts immediately. Starting with your next renewal you&apos;ll be billed {money(preview.target.netPriceCents)}/{cadence(preview.target.billingCadence)}.</p>
                    {needsCard && (
                      <p className="flex items-center gap-2 pt-1 text-apple-orange">
                        <CreditCard className="h-4 w-4" />
                        You need a card on file to upgrade. <Link href="/portal/billing" className="font-medium underline">Add a card</Link>
                      </p>
                    )}
                  </>
                ) : (
                  <p className="pt-1 text-apple-text-secondary">
                    You keep {preview.current.displayName} through {when(preview.effectiveAt)}. The new plan and price start then — nothing is charged today.
                  </p>
                )}
                {preview.pendingChange && !unchanged && (
                  <p className="pt-1 text-apple-text-tertiary">This replaces the change you already scheduled ({preview.pendingChange.displayName} on {when(preview.pendingChange.effectiveAt)}).</p>
                )}
              </dl>
            ) : null}
            {error && <p className="mt-2 text-apple-red">{error}</p>}
          </section>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="w-24 shrink-0 text-apple-text-tertiary">{label}</dt>
      <dd className="text-apple-text-secondary">{children}</dd>
    </div>
  );
}
