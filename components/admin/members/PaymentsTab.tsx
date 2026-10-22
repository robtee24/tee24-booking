"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, CreditCard, Plus, Receipt, Undo2, Wallet } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, Money, Select, StatusBadge, Textarea, useToast } from "@/components/ui";
import { Checkbox, ErrorBanner, LoadingRows, api, errMsg, fmtDate, fmtDateTime, todayInput } from "./shared";

type Refund = { id: string; amountCents: number; status: string; reason: string | null; createdAt: string };
type Charge = { id: string; status: string; amountCents: number; squarePaymentId: string | null; failureReason: string | null; createdAt: string; refunds: Refund[] };
type Line = { id: string; description: string; quantity: number; unitCents: number; totalCents: number };
type Invoice = {
  id: string; number: number; status: string; dueDate: string; paidAt: string | null; description: string | null;
  subtotalCents: number; discountCents: number; taxCents: number; refundedCents: number; totalCents: number; adminNotes: string | null; lastFailureReason: string | null; payToken: string | null;
  lineItems: Line[]; charges: Charge[]; subscription: { id: string; plan: { name: string } } | null;
};
type PM = { id: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; isDefault: boolean; status: string; source: string };
type Credit = { id: string; type: string; amountCents: number; reason: string | null; createdAt: string };
type Data = { invoices: Invoice[]; creditBalanceCents: number; credits: Credit[]; paymentMethods: PM[]; summary: { outstandingCents: number; overdueCents: number; counts: Record<string, number> }; taxRateBps: number };

const FILTERS = [
  { value: "ALL", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "PAID", label: "Paid" },
  { value: "PAST_DUE", label: "Past due" },
  { value: "FAILED", label: "Failed" },
  { value: "REFUNDED", label: "Refunded" },
  { value: "CANCELLED", label: "Cancelled" },
];

type ModalKind = null | { kind: "charge" } | { kind: "credit" } | { kind: "markPaid"; inv: Invoice } | { kind: "cancel"; inv: Invoice } | { kind: "refund"; charge: Charge; inv: Invoice };

export function PaymentsTab({ slug, memberId }: { slug: string; memberId: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [filter, setFilter] = React.useState("ALL");
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [modal, setModal] = React.useState<ModalKind>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setError(null);
    api<Data>(`/api/admin/members/${memberId}/invoices?status=${filter}`).then(setData).catch((e) => setError(errMsg(e)));
  }, [memberId, filter]);
  React.useEffect(load, [load]);

  async function run(fn: () => Promise<any>, success: string) {
    setBusy(true);
    try {
      const r = await fn();
      if (r?.chargeError) toast({ tone: "info", title: "Invoice created, card charge failed", description: String(r.chargeError) });
      else toast({ tone: "success", title: success });
      setModal(null);
      load();
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Action failed", description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  async function setDefaultPm(paymentMethodId: string) {
    await run(() => api(`/api/admin/members/${memberId}/payment-methods`, { method: "POST", json: { paymentMethodId } }), "Default card updated");
  }

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return <LoadingRows n={3} />;

  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-apple-lg font-semibold text-apple-text">Payments</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" iconLeft={<Wallet className="h-4 w-4" />} onClick={() => setModal({ kind: "credit" })}>Add credit</Button>
          <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setModal({ kind: "charge" })}>New charge</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <div className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">Outstanding</div>
          <Money cents={data.summary.outstandingCents} className="mt-1 block text-apple-xl font-semibold text-apple-text" />
        </Card>
        <Card>
          <div className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">Overdue</div>
          <Money cents={data.summary.overdueCents} className={`mt-1 block text-apple-xl font-semibold ${data.summary.overdueCents > 0 ? "text-apple-red" : "text-apple-text"}`} />
        </Card>
        <Card>
          <div className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">Account credit</div>
          <Money cents={data.creditBalanceCents} className="mt-1 block text-apple-xl font-semibold text-apple-green" />
        </Card>
      </div>

      <Card>
        <CardHeader title="Cards on file" subtitle="Members add cards from the portal; staff can pick which is default." />
        {data.paymentMethods.length === 0 ? (
          <p className="mt-3 text-apple-sm text-apple-text-tertiary">No card on file. Send the member an account access link so they can add one.</p>
        ) : (
          <ul className="mt-3 divide-y divide-apple-divider">
            {data.paymentMethods.map((pm) => (
              <li key={pm.id} className="flex items-center justify-between gap-3 py-2 text-apple-sm">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-apple-text-tertiary" />
                  <span className="text-apple-text">{pm.brand ?? pm.source} •••• {pm.last4}</span>
                  {pm.expMonth && pm.expYear && <span className="text-apple-xs text-apple-text-tertiary">exp {String(pm.expMonth).padStart(2, "0")}/{String(pm.expYear).slice(-2)}</span>}
                  {pm.status !== "ACTIVE" && <StatusBadge status={pm.status} size="sm" />}
                </div>
                {pm.isDefault ? <Badge tone="info" size="sm">Default</Badge> : <Button size="sm" variant="ghost" onClick={() => void setDefaultPm(pm.id)} disabled={busy}>Make default</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padded={false}>
        <div className="flex flex-col gap-2 border-b border-apple-divider p-4 sm:flex-row sm:items-center sm:justify-between">
          <CardHeader title="Invoices" />
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {FILTERS.map((f) => (
              <button key={f.value} type="button" onClick={() => setFilter(f.value)} className={`shrink-0 rounded-apple-pill px-3 py-1 text-apple-xs font-medium ${filter === f.value ? "bg-apple-text text-white" : "bg-apple-fill-secondary text-apple-text-secondary hover:text-apple-text"}`}>
                {f.label}{f.value !== "ALL" && f.value !== "OPEN" && data.summary.counts[f.value] ? ` ${data.summary.counts[f.value]}` : ""}
              </button>
            ))}
          </div>
        </div>
        {data.invoices.length === 0 ? (
          <div className="p-4"><EmptyState icon={<Receipt className="h-5 w-5" />} title="No invoices" description="Charges and recurring invoices will appear here." /></div>
        ) : (
          <ul className="divide-y divide-apple-divider">
            {data.invoices.map((inv) => {
              const open = expanded.has(inv.id);
              const canMarkPaid = ["SCHEDULED", "PAST_DUE", "FAILED"].includes(inv.status);
              const refundable = inv.charges.filter((c) => c.status === "SUCCEEDED" || c.status === "PARTIALLY_REFUNDED");
              return (
                <li key={inv.id}>
                  <button type="button" onClick={() => toggle(inv.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-apple-fill-secondary/50">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-apple-sm">
                        <span className="font-medium text-apple-text">#{inv.number}</span>
                        <span className="truncate text-apple-text-secondary">{inv.description ?? inv.subscription?.plan.name ?? "Invoice"}</span>
                      </div>
                      <div className="text-apple-xs text-apple-text-tertiary">
                        Due {fmtDate(inv.dueDate)}{inv.paidAt ? ` · Paid ${fmtDate(inv.paidAt)}` : ""}{inv.lastFailureReason ? ` · ${inv.lastFailureReason}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Money cents={inv.totalCents} className="text-apple-sm font-medium text-apple-text" />
                      <StatusBadge status={inv.status} size="sm" />
                      {open ? <ChevronUp className="h-4 w-4 text-apple-text-tertiary" /> : <ChevronDown className="h-4 w-4 text-apple-text-tertiary" />}
                    </div>
                  </button>
                  {open && (
                    <div className="space-y-3 bg-apple-fill-secondary/40 px-4 py-3 text-apple-sm">
                      <table className="w-full text-apple-sm">
                        <tbody>
                          {inv.lineItems.map((l) => (
                            <tr key={l.id}>
                              <td className="py-0.5 text-apple-text">{l.description}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</td>
                              <td className="py-0.5 text-right"><Money cents={l.totalCents} /></td>
                            </tr>
                          ))}
                          {inv.discountCents > 0 && <tr><td className="py-0.5 text-apple-text-secondary">Discount</td><td className="py-0.5 text-right text-apple-green">−<Money cents={inv.discountCents} /></td></tr>}
                          {inv.taxCents > 0 && <tr><td className="py-0.5 text-apple-text-secondary">Tax</td><td className="py-0.5 text-right"><Money cents={inv.taxCents} /></td></tr>}
                          {inv.refundedCents > 0 && <tr><td className="py-0.5 text-apple-text-secondary">Refunded</td><td className="py-0.5 text-right text-apple-red">−<Money cents={inv.refundedCents} /></td></tr>}
                          <tr className="border-t border-apple-divider"><td className="pt-1 font-semibold text-apple-text">Total</td><td className="pt-1 text-right font-semibold"><Money cents={inv.totalCents} /></td></tr>
                        </tbody>
                      </table>

                      {inv.charges.length > 0 && (
                        <div>
                          <div className="mb-1 text-apple-xs uppercase tracking-wide text-apple-text-tertiary">Charges</div>
                          <ul className="space-y-1">
                            {inv.charges.map((c) => (
                              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <StatusBadge status={c.status} size="sm" />
                                  <span className="text-apple-text-secondary">{fmtDateTime(c.createdAt)}</span>
                                  <span className="text-apple-xs text-apple-text-tertiary">{c.squarePaymentId ? "card" : "manual"}</span>
                                  {c.failureReason && <span className="text-apple-xs text-apple-red">{c.failureReason}</span>}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Money cents={c.amountCents} />
                                  {refundable.includes(c) && (
                                    <Button size="sm" variant="ghost" iconLeft={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setModal({ kind: "refund", charge: c, inv })}>Refund</Button>
                                  )}
                                </div>
                                {c.refunds.length > 0 && (
                                  <ul className="w-full pl-6 text-apple-xs text-apple-text-tertiary">
                                    {c.refunds.map((r) => <li key={r.id}>Refund <Money cents={r.amountCents} /> · {r.status.toLowerCase()} · {fmtDate(r.createdAt)}{r.reason ? ` · ${r.reason}` : ""}</li>)}
                                  </ul>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {inv.adminNotes && <p className="whitespace-pre-wrap text-apple-xs text-apple-text-tertiary">{inv.adminNotes}</p>}

                      <div className="flex flex-wrap gap-2">
                        <Link href={adminRoutes.loc.billing.invoiceDetail(slug, inv.id)} className="inline-flex h-8 items-center rounded-apple-sm border border-apple-border bg-white px-3 text-apple-xs font-medium text-apple-text hover:bg-apple-fill-secondary">Open invoice</Link>
                        {canMarkPaid && <Button size="sm" variant="secondary" onClick={() => setModal({ kind: "markPaid", inv })}>Mark paid</Button>}
                        {canMarkPaid && <Button size="sm" variant="danger" onClick={() => setModal({ kind: "cancel", inv })}>Cancel invoice</Button>}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {data.credits.length > 0 && (
        <Card padded={false}>
          <div className="px-4 pt-4"><CardHeader title="Credit ledger" /></div>
          <ul className="mt-2 divide-y divide-apple-divider">
            {data.credits.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-2 text-apple-sm">
                <div>
                  <span className="text-apple-text">{c.type.replace(/_/g, " ").toLowerCase()}</span>
                  {c.reason && <span className="ml-2 text-apple-text-tertiary">{c.reason}</span>}
                  <div className="text-apple-xs text-apple-text-tertiary">{fmtDateTime(c.createdAt)}</div>
                </div>
                <Money cents={c.amountCents} className={c.amountCents < 0 ? "text-apple-red" : "text-apple-green"} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {modal?.kind === "charge" && <ChargeModal taxRateBps={data.taxRateBps} hasCard={data.paymentMethods.some((p) => p.status === "ACTIVE")} busy={busy} onClose={() => setModal(null)} onSubmit={(b) => run(() => api(`/api/admin/members/${memberId}/invoices`, { method: "POST", json: b }), b.chargeNow ? "Charged" : "Invoice created")} />}
      {modal?.kind === "credit" && <CreditModal busy={busy} onClose={() => setModal(null)} onSubmit={(b) => run(() => api(`/api/admin/members/${memberId}/credits`, { method: "POST", json: b }), "Credit added")} />}
      {modal?.kind === "markPaid" && <MarkPaidModal inv={modal.inv} busy={busy} onClose={() => setModal(null)} onSubmit={(b) => run(() => api(`/api/admin/members/${memberId}/invoices/${modal.inv.id}`, { method: "POST", json: { action: "mark-paid", ...b } }), "Invoice marked paid")} />}
      {modal?.kind === "cancel" && <CancelInvoiceModal inv={modal.inv} busy={busy} onClose={() => setModal(null)} onSubmit={(b) => run(() => api(`/api/admin/members/${memberId}/invoices/${modal.inv.id}`, { method: "POST", json: { action: "cancel", ...b } }), "Invoice cancelled")} />}
      {modal?.kind === "refund" && <RefundModal charge={modal.charge} busy={busy} onClose={() => setModal(null)} onSubmit={(b) => run(() => api(`/api/admin/members/${memberId}/refunds`, { method: "POST", json: { chargeId: modal.charge.id, ...b } }), "Refund issued")} />}
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

function ChargeModal({ taxRateBps, hasCard, busy, onClose, onSubmit }: { taxRateBps: number; hasCard: boolean; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const [description, setDescription] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [quantity, setQuantity] = React.useState("1");
  const [taxable, setTaxable] = React.useState(taxRateBps > 0);
  const [discountMode, setDiscountMode] = React.useState<"none" | "amount" | "percent">("none");
  const [discount, setDiscount] = React.useState("");
  const [dueDate, setDueDate] = React.useState(todayInput());
  const [chargeNow, setChargeNow] = React.useState(hasCard);
  const [adminNotes, setAdminNotes] = React.useState("");

  const subtotal = Math.round(Number(amount || 0) * 100) * Math.max(1, Number(quantity) || 1);
  const disc = discountMode === "percent" ? Math.round((subtotal * Number(discount || 0)) / 100) : discountMode === "amount" ? Math.round(Number(discount || 0) * 100) : 0;
  const tax = taxable ? Math.round(((subtotal - disc) * taxRateBps) / 10_000) : 0;
  const total = Math.max(0, subtotal - disc + tax);

  return (
    <Modal open onClose={onClose} title="New charge" description="Creates a one-time invoice; optionally charges the default card now." footer={<Footer onClose={onClose} busy={busy} label={chargeNow ? `Charge ${(total / 100).toFixed(2)}` : "Create invoice"} disabled={!description.trim() || subtotal <= 0} onSubmit={() => onSubmit({ description: description.trim(), amount, quantity: Number(quantity) || 1, taxable, discountAmount: discountMode === "amount" ? discount : undefined, discountPercent: discountMode === "percent" ? discount : undefined, dueDate, chargeNow, adminNotes: adminNotes || undefined })} />}>
      <div className="space-y-3">
        <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Guest fee, lesson, merchandise…" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Unit price ($)" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input label="Quantity" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Discount" value={discountMode} onChange={(e) => setDiscountMode(e.target.value as any)}>
            <option value="none">None</option>
            <option value="amount">Amount ($)</option>
            <option value="percent">Percent (%)</option>
          </Select>
          {discountMode !== "none" ? <Input label={discountMode === "amount" ? "Discount ($)" : "Discount (%)"} type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /> : <Input label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
        </div>
        {discountMode !== "none" && <Input label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
        <Checkbox label={`Taxable (${(taxRateBps / 100).toFixed(2)}%)`} checked={taxable} onChange={setTaxable} />
        <Checkbox label="Charge default card now" checked={chargeNow} onChange={setChargeNow} hint={hasCard ? undefined : "No active card on file — invoice will be left open."} />
        <Textarea label="Internal notes" rows={2} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />
        <div className="rounded-apple-sm bg-apple-fill-secondary p-3 text-apple-sm">
          <div className="flex justify-between text-apple-text-secondary"><span>Subtotal</span><Money cents={subtotal} /></div>
          {disc > 0 && <div className="flex justify-between text-apple-green"><span>Discount</span><span>−<Money cents={disc} /></span></div>}
          {tax > 0 && <div className="flex justify-between text-apple-text-secondary"><span>Tax</span><Money cents={tax} /></div>}
          <div className="mt-1 flex justify-between border-t border-apple-divider pt-1 font-semibold text-apple-text"><span>Total</span><Money cents={total} /></div>
        </div>
      </div>
    </Modal>
  );
}

function CreditModal({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const [amount, setAmount] = React.useState("");
  const [type, setType] = React.useState("ADJUSTMENT");
  const [reason, setReason] = React.useState("");
  return (
    <Modal open onClose={onClose} title="Add account credit" description="Credit is applied automatically to future invoices. Use a negative amount to remove credit." footer={<Footer onClose={onClose} busy={busy} label="Add credit" disabled={!Number(amount)} onSubmit={() => onSubmit({ amount, type, reason: reason || undefined })} />}>
      <div className="space-y-3">
        <Input label="Amount ($)" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="ADJUSTMENT">Adjustment</option>
          <option value="COMP">Comp</option>
          <option value="REFERRAL">Referral</option>
        </Select>
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}

function MarkPaidModal({ inv, busy, onClose, onSubmit }: { inv: Invoice; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const [method, setMethod] = React.useState("CASH");
  const [note, setNote] = React.useState("");
  return (
    <Modal open onClose={onClose} title={`Mark invoice #${inv.number} paid`} description="Records an off-platform payment (no card is charged)." footer={<Footer onClose={onClose} busy={busy} label="Mark paid" onSubmit={() => onSubmit({ method, note: note || undefined })} />}>
      <div className="space-y-3">
        <div className="flex justify-between rounded-apple-sm bg-apple-fill-secondary p-3 text-apple-sm"><span>Amount</span><Money cents={inv.totalCents} className="font-semibold" /></div>
        <Select label="Paid by" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="CASH">Cash</option>
          <option value="CHECK">Check</option>
          <option value="OTHER">Other</option>
        </Select>
        <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

function CancelInvoiceModal({ inv, busy, onClose, onSubmit }: { inv: Invoice; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const [reason, setReason] = React.useState("");
  return (
    <Modal open onClose={onClose} title={`Cancel invoice #${inv.number}?`} description="The invoice is written off and will not be charged." footer={<Footer danger onClose={onClose} busy={busy} label="Cancel invoice" onSubmit={() => onSubmit({ reason: reason || undefined })} />}>
      <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

function RefundModal({ charge, busy, onClose, onSubmit }: { charge: Charge; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const refunded = charge.refunds.filter((r) => r.status !== "FAILED").reduce((s, r) => s + r.amountCents, 0);
  const max = charge.amountCents - refunded;
  const [amount, setAmount] = React.useState((max / 100).toFixed(2));
  const [reason, setReason] = React.useState("");
  const [asCredit, setAsCredit] = React.useState(!charge.squarePaymentId);
  const cents = Math.round(Number(amount || 0) * 100);
  return (
    <Modal open onClose={onClose} title="Refund" description={charge.squarePaymentId ? "Refunds go back to the original card unless issued as credit." : "This was a manual payment — it can only be refunded as account credit."} footer={<Footer onClose={onClose} busy={busy} label={asCredit ? "Issue credit" : "Refund to card"} disabled={cents <= 0 || cents > max} onSubmit={() => onSubmit({ amount, reason: reason || undefined, asCredit })} />}>
      <div className="space-y-3">
        <Input label={`Amount ($) — up to ${(max / 100).toFixed(2)}`} type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Checkbox label="Issue as account credit instead of refunding the card" checked={asCredit} onChange={setAsCredit} />
      </div>
    </Modal>
  );
}
