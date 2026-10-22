"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, Drawer, Input, Money, StatusBadge, useToast } from "@/components/ui";
import { CheckCircle2, Gift, Link2, PackagePlus, Send } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { useAdminLocation } from "@/components/admin/LocationContext";
import { MemberSearch, fmtDate, useErrorToast, useMarketingApi } from "./shared";

type Mini = { id: string; firstName: string; lastName: string; email: string; status: string; referralCode: string | null; paypalAccount: { paypalEmail: string } | null } | null;
type ReferralRow = { id: string; referrerId: string; referredMemberId: string; payoutId: string | null; earnedCents: number; earnedKind: string; createdAt: string; state: "pending" | "confirmed" | "paid"; payout: PayoutRow | null; referrer: Mini; referred: Mini };
type PayoutRow = { id: string; referrerId: string; amountCents: number; status: string; paypalTxnId: string | null; periodStart: string; periodEnd: string; createdAt: string; paidAt: string | null; referrer?: Mini };
type Unmatched = { id: string; firstName: string; lastName: string; referredById: string | null; joinDate: string | null };

export type ReferralsData = { items: ReferralRow[]; payouts: PayoutRow[]; unmatched: Unmatched[]; paypalConfigured: boolean };

type Props = { initial: ReferralsData; rewardLabel: string; canSendPayouts: boolean };

const TABS = ["pending", "confirmed", "paid"] as const;

export function ReferralsClient({ initial, rewardLabel, canSendPayouts }: Props) {
  const api = useMarketingApi();
  const onError = useErrorToast();
  const router = useRouter();
  const { toast } = useToast();
  const { slug } = useAdminLocation();
  const [data, setData] = React.useState<ReferralsData>(initial);
  const [tab, setTab] = React.useState<(typeof TABS)[number]>("pending");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [assigning, setAssigning] = React.useState<Unmatched | null>(null);
  const [selectedPayouts, setSelectedPayouts] = React.useState<string[]>([]);

  async function reload() {
    try {
      setData(await api<ReferralsData>("/api/admin/referrals"));
      router.refresh();
    } catch (e) {
      onError(e);
    }
  }

  async function buildBatch() {
    if (!confirm("Group all pending PAYMENT referrals into payout batches for their referrers?")) return;
    setBusy("batch");
    try {
      const res = await api<{ created: number | unknown }>("/api/admin/referrals/build-batch", { method: "POST", json: {} });
      toast({ tone: "success", title: "Payout batch built", description: typeof res.created === "number" ? `${res.created} payout${res.created === 1 ? "" : "s"} created` : undefined });
      await reload();
      setTab("confirmed");
    } catch (e) {
      onError(e, "Batch failed");
    } finally {
      setBusy(null);
    }
  }

  async function setPayoutStatus(id: string, status: "APPROVED" | "PENDING" | "PAID") {
    setBusy(id);
    try {
      await api(`/api/admin/referrals/payouts/${id}`, { method: "PATCH", json: { status } });
      await reload();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  async function sendPayouts() {
    const ids = selectedPayouts.length ? selectedPayouts : data.payouts.filter((p) => p.status === "APPROVED").map((p) => p.id);
    if (ids.length === 0) return;
    if (!confirm(`Send ${ids.length} approved payout${ids.length === 1 ? "" : "s"} via PayPal now? This moves real money.`)) return;
    setBusy("send");
    try {
      const res = await api<{ sent?: number; failed?: number }>("/api/admin/referrals/send-payouts", { method: "POST", json: { payoutIds: ids } });
      toast({ tone: "success", title: "Payouts sent", description: `${res.sent ?? ids.length} sent${res.failed ? ` · ${res.failed} failed` : ""}` });
      setSelectedPayouts([]);
      await reload();
      setTab("paid");
    } catch (e) {
      onError(e, "Send failed");
    } finally {
      setBusy(null);
    }
  }

  async function removeReferral(r: ReferralRow) {
    if (!confirm("Remove this referral? The reward will not be paid.")) return;
    setBusy(r.id);
    try {
      await api(`/api/admin/referrals/${r.id}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  const rows = data.items.filter((r) => r.state === tab);
  const counts = { pending: data.items.filter((r) => r.state === "pending").length, confirmed: data.items.filter((r) => r.state === "confirmed").length, paid: data.items.filter((r) => r.state === "paid").length };
  const openPayouts = data.payouts.filter((p) => ["PENDING", "APPROVED"].includes(p.status));
  const approvedCount = openPayouts.filter((p) => p.status === "APPROVED").length;
  const name = (m: Mini) => (m ? `${m.firstName} ${m.lastName}` : "Unknown member");

  return (
    <div className="space-y-4">
      {data.unmatched.length > 0 && (
        <Card>
          <CardHeader title={`${data.unmatched.length} unmatched referral${data.unmatched.length === 1 ? "" : "s"}`} subtitle="These members said someone referred them but no reward has been recorded. Assign a referrer to credit the reward." />
          <ul className="mt-3 divide-y divide-apple-divider">
            {data.unmatched.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-apple-sm">
                <div>
                  <Link href={adminRoutes.loc.members.detail(slug, m.id)} className="font-medium text-apple-text hover:text-apple-blue">{m.firstName} {m.lastName}</Link>
                  <div className="text-apple-xs text-apple-text-tertiary">Joined {fmtDate(m.joinDate, { month: "short", day: "numeric", year: "numeric" })}</div>
                </div>
                <Button size="sm" variant="secondary" iconLeft={<Link2 className="h-4 w-4" />} onClick={() => setAssigning(m)}>Assign referrer</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card padded={false}>
        <div className="flex flex-col gap-2 border-b border-apple-divider px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1">
            {TABS.map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-apple-sm px-3 py-1.5 text-apple-sm font-medium capitalize ${tab === t ? "bg-apple-fill-secondary text-apple-text" : "text-apple-text-secondary hover:text-apple-text"}`}>
                {t} <span className="text-apple-xs text-apple-text-tertiary">{counts[t]}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-apple-xs text-apple-text-tertiary">Reward: {rewardLabel}</span>
            {tab === "pending" && counts.pending > 0 && (
              <Button size="sm" iconLeft={<PackagePlus className="h-4 w-4" />} onClick={buildBatch} loading={busy === "batch"}>Build payout batch</Button>
            )}
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-apple-text-tertiary">
            <Gift className="h-6 w-6" />
            <p className="text-apple-sm">
              {tab === "pending" ? "No rewards waiting. Referrals appear here when a referred member joins." : tab === "confirmed" ? "No rewards in an open payout batch." : "Nothing paid yet."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-apple-divider">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 p-4 text-apple-sm">
                <div className="min-w-0">
                  <div className="truncate">
                    <Link href={adminRoutes.loc.members.detail(slug, r.referrerId)} className="font-medium text-apple-text hover:text-apple-blue">{name(r.referrer)}</Link>
                    <span className="text-apple-text-tertiary"> referred </span>
                    <Link href={adminRoutes.loc.members.detail(slug, r.referredMemberId)} className="font-medium text-apple-text hover:text-apple-blue">{name(r.referred)}</Link>
                  </div>
                  <div className="text-apple-xs text-apple-text-tertiary">
                    {fmtDate(r.createdAt, { month: "short", day: "numeric", year: "numeric" })} · {r.earnedKind === "CREDIT" ? "account credit" : r.referrer?.paypalAccount ? `PayPal ${r.referrer.paypalAccount.paypalEmail}` : "PayPal not linked"}
                    {r.payout ? ` · batch ${r.payout.status.toLowerCase()}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Money cents={r.earnedCents} className="font-medium" />
                  <Badge tone={r.state === "paid" ? "success" : r.state === "confirmed" ? "info" : "warn"} size="sm">{r.state}</Badge>
                  {r.state === "pending" && (
                    <button type="button" onClick={() => removeReferral(r)} disabled={busy === r.id} className="text-apple-xs text-apple-text-tertiary hover:text-apple-red">Remove</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {(tab === "confirmed" || openPayouts.length > 0) && (
        <Card padded={false}>
          <div className="flex flex-col gap-2 border-b border-apple-divider px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <CardHeader title="Payout batches" subtitle={`${openPayouts.length} open · ${approvedCount} approved`} className="!mb-0" />
            <div className="flex items-center gap-2">
              {!data.paypalConfigured && <Badge tone="warn" size="sm">PayPal not configured</Badge>}
              <Button
                size="sm"
                iconLeft={<Send className="h-4 w-4" />}
                onClick={sendPayouts}
                loading={busy === "send"}
                disabled={!data.paypalConfigured || !canSendPayouts || (selectedPayouts.length === 0 && approvedCount === 0)}
                title={!canSendPayouts ? "Requires the send-payouts permission" : undefined}
              >
                Send {selectedPayouts.length ? `${selectedPayouts.length} selected` : "all approved"}
              </Button>
            </div>
          </div>
          {openPayouts.length === 0 ? (
            <p className="p-6 text-center text-apple-sm text-apple-text-tertiary">No open payout batches. Build one from pending rewards.</p>
          ) : (
            <ul className="divide-y divide-apple-divider">
              {openPayouts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 p-4 text-apple-sm">
                  <label className="flex min-w-0 items-center gap-3">
                    <input type="checkbox" disabled={p.status !== "APPROVED"} checked={selectedPayouts.includes(p.id)} onChange={(e) => setSelectedPayouts((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))} />
                    <div className="min-w-0">
                      <Link href={adminRoutes.loc.members.detail(slug, p.referrerId)} className="font-medium text-apple-text hover:text-apple-blue">{name(p.referrer ?? null)}</Link>
                      <div className="text-apple-xs text-apple-text-tertiary">
                        {fmtDate(p.periodStart, { month: "short", day: "numeric" })} – {fmtDate(p.periodEnd, { month: "short", day: "numeric", year: "numeric" })}
                        {p.referrer?.paypalAccount ? ` · ${p.referrer.paypalAccount.paypalEmail}` : " · no PayPal email on file"}
                      </div>
                    </div>
                  </label>
                  <div className="flex shrink-0 items-center gap-2">
                    <Money cents={p.amountCents} className="font-medium" />
                    <StatusBadge status={p.status} size="sm" />
                    {p.status === "PENDING" ? (
                      <Button size="sm" variant="secondary" iconLeft={<CheckCircle2 className="h-4 w-4" />} onClick={() => setPayoutStatus(p.id, "APPROVED")} loading={busy === p.id}>Approve</Button>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setPayoutStatus(p.id, "PENDING")} loading={busy === p.id}>Unapprove</Button>
                        <Button size="sm" variant="ghost" onClick={() => { if (confirm("Mark as paid outside PayPal (cash, Venmo, credit)?")) void setPayoutStatus(p.id, "PAID"); }} loading={busy === p.id}>Mark paid</Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {assigning && (
        <AssignDrawer
          member={assigning}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function AssignDrawer({ member, onClose, onDone }: { member: Unmatched; onClose: () => void; onDone: () => void }) {
  const api = useMarketingApi();
  const onError = useErrorToast();
  const { toast } = useToast();
  const [picked, setPicked] = React.useState<{ id: string; firstName: string; lastName: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function assign() {
    setBusy(true);
    try {
      await api("/api/admin/referrals", { method: "POST", json: { referredMemberId: member.id, referrerId: picked?.id, referralCode: picked ? undefined : code.trim() || undefined } });
      toast({ tone: "success", title: "Referral recorded" });
      onDone();
    } catch (e) {
      onError(e, "Could not assign");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title="Assign referrer" description={`Who referred ${member.firstName} ${member.lastName}?`} footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={assign} loading={busy} disabled={!picked && !code.trim()}>Record referral</Button></div>}>
      <div className="space-y-4">
        {picked ? (
          <div className="flex items-center justify-between rounded-apple-sm bg-apple-fill-secondary p-2 text-apple-sm">
            <span>{picked.firstName} {picked.lastName}</span>
            <button type="button" className="text-apple-xs text-apple-blue" onClick={() => setPicked(null)}>Change</button>
          </div>
        ) : (
          <MemberSearch onPick={(m) => setPicked(m)} placeholder="Search referrer by name, email or phone…" />
        )}
        <div className="text-center text-apple-xs text-apple-text-tertiary">or</div>
        <Input label="Referral code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. JORDAN24" disabled={!!picked} />
      </div>
    </Drawer>
  );
}
