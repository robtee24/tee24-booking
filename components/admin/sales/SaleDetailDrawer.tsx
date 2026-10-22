// components/admin/sales/SaleDetailDrawer.tsx
"use client";

import React from "react";
import { Ban, Mail, RotateCcw } from "lucide-react";
import { Badge, Button, Drawer, Input, Modal, StatusBadge, Textarea, formatMoney, useToast } from "@/components/ui";
import { posFetch } from "./api";
import type { SaleDTO } from "./types";
import { PAYMENT_KIND_LABELS } from "./types";

export function SaleDetailDrawer({ slug, sale, onClose, onChanged }: { slug: string; sale: SaleDTO | null; onClose: () => void; onChanged: (s: SaleDTO) => void }) {
  const { toast } = useToast();
  const [refundOpen, setRefundOpen] = React.useState(false);
  const [voidOpen, setVoidOpen] = React.useState(false);
  const [lineIds, setLineIds] = React.useState<Set<string>>(new Set());
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [emailTo, setEmailTo] = React.useState("");

  React.useEffect(() => { setLineIds(new Set()); setReason(""); setEmailTo(sale?.customerEmail ?? ""); }, [sale?.id, sale?.customerEmail]);

  if (!sale) return <Drawer open={false} onClose={onClose}><span /></Drawer>;

  const refundedLineIds = new Set(sale.refunds.flatMap((r) => r.lineItemIds));
  const sameDay = new Date(sale.createdAt).toDateString() === new Date().toDateString();
  const canRefund = sale.status === "PAID";
  const canVoid = sale.status === "PAID" && sameDay && sale.refundedCents === 0;
  const remaining = sale.totalCents - sale.refundedCents;

  async function act(path: string, body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      const r = await posFetch<{ sale: SaleDTO }>(`/api/admin/sales/${encodeURIComponent(sale!.id)}/${path}`, { method: "POST", body: JSON.stringify({ locationSlug: slug, ...body }) });
      toast({ tone: "success", title: ok });
      setRefundOpen(false); setVoidOpen(false);
      onChanged(r.sale);
    } catch (e) {
      toast({ tone: "error", title: "Action failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    try {
      const r = await posFetch<{ sent: boolean; to: string }>(`/api/admin/sales/${encodeURIComponent(sale!.id)}/receipt`, { method: "POST", body: JSON.stringify({ locationSlug: slug, to: emailTo }) });
      toast(r.sent ? { tone: "success", title: `Receipt sent to ${r.to}` } : { tone: "error", title: "Email isn't configured" });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't send", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  const selectedAmount = (() => {
    if (lineIds.size === 0) return remaining;
    const sel = sale.lineItems.filter((li) => lineIds.has(li.id));
    if (sel.length === sale.lineItems.length) return remaining;
    const share = sale.subtotalCents > 0 ? sel.reduce((a, li) => a + li.totalCents, 0) / sale.subtotalCents : 0;
    return Math.min(remaining, Math.round(sale.totalCents * share));
  })();

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Sale #${sale.number}`}
      description={new Date(sale.createdAt).toLocaleString()}
      width="lg"
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {canVoid && <Button variant="danger" iconLeft={<Ban className="h-4 w-4" />} onClick={() => setVoidOpen(true)}>Void</Button>}
          {canRefund && <Button variant="secondary" iconLeft={<RotateCcw className="h-4 w-4" />} onClick={() => { setLineIds(new Set()); setRefundOpen(true); }}>Refund</Button>}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={sale.status} />
          <Badge tone="muted">{PAYMENT_KIND_LABELS[sale.paymentKind]}</Badge>
          {sale.status === "PAID" && sale.refundedCents > 0 && <Badge tone="warn">Refunded {formatMoney(sale.refundedCents)}</Badge>}
          {sale.staffName && <Badge tone="muted">by {sale.staffName}</Badge>}
        </div>

        <section>
          <h3 className="mb-2 text-apple-xs font-semibold uppercase tracking-wide text-apple-text-tertiary">Items</h3>
          <ul className="divide-y divide-apple-divider rounded-apple border border-apple-border">
            {sale.lineItems.map((li) => (
              <li key={li.id} className="flex items-center justify-between gap-3 px-3 py-2 text-apple-sm">
                <div className="min-w-0">
                  <div className="truncate text-apple-text">{li.description}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">{li.quantity} × {formatMoney(li.unitCents)}{refundedLineIds.has(li.id) ? " · refunded" : ""}</div>
                </div>
                <span className={["tabular-nums", refundedLineIds.has(li.id) ? "text-apple-text-tertiary line-through" : ""].join(" ")}>{formatMoney(li.totalCents)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 text-apple-sm">
            <Row label="Subtotal" value={formatMoney(sale.subtotalCents)} />
            {sale.discountCents > 0 && <Row label="Discount" value={`−${formatMoney(sale.discountCents)}`} />}
            <Row label="Tax" value={formatMoney(sale.taxCents)} />
            <div className="flex justify-between border-t border-apple-divider pt-2 text-apple-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(sale.totalCents)}</dd></div>
          </dl>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-apple-xs font-semibold uppercase tracking-wide text-apple-text-tertiary">Customer</h3>
            <div className="text-apple-sm text-apple-text">{sale.customerName ?? <span className="text-apple-text-tertiary">Walk-in</span>}</div>
            {sale.customerEmail && <div className="text-apple-xs text-apple-text-secondary">{sale.customerEmail}</div>}
            {sale.memberId && <Badge size="sm" tone="info" className="mt-1">Member</Badge>}
          </div>
          <div>
            <h3 className="mb-2 text-apple-xs font-semibold uppercase tracking-wide text-apple-text-tertiary">Payment</h3>
            <div className="text-apple-sm text-apple-text">{PAYMENT_KIND_LABELS[sale.paymentKind]}</div>
            <div className="text-apple-xs text-apple-text-secondary">
              {sale.payment.tenderedCents != null && <>Tendered {formatMoney(sale.payment.tenderedCents)} · change {formatMoney(sale.payment.changeCents ?? 0)}<br /></>}
              {sale.payment.reference && <>Ref: {sale.payment.reference}<br /></>}
              {sale.payment.giftCardLast4 && <>Gift card ****-{sale.payment.giftCardLast4}<br /></>}
              {sale.chargeId && <>Charge {sale.chargeId.slice(0, 8)}…</>}
            </div>
          </div>
        </section>

        {sale.notes && (
          <section>
            <h3 className="mb-2 text-apple-xs font-semibold uppercase tracking-wide text-apple-text-tertiary">Notes</h3>
            <p className="whitespace-pre-wrap text-apple-sm text-apple-text">{sale.notes}</p>
          </section>
        )}

        {sale.refunds.length > 0 && (
          <section>
            <h3 className="mb-2 text-apple-xs font-semibold uppercase tracking-wide text-apple-text-tertiary">Refund history</h3>
            <ul className="space-y-1 text-apple-sm">
              {sale.refunds.map((r, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="text-apple-text-secondary">{new Date(r.at).toLocaleString()} · {r.kind === "void" ? "Voided" : "Refund"}{r.reason ? ` — ${r.reason}` : ""}</span>
                  <span className="tabular-nums">{formatMoney(r.amountCents)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-apple-xs font-semibold uppercase tracking-wide text-apple-text-tertiary">Receipt</h3>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input type="email" placeholder="Email address" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} />
            <Button variant="secondary" iconLeft={<Mail className="h-4 w-4" />} loading={busy} disabled={!emailTo.includes("@")} onClick={() => void resend()}>Resend</Button>
          </div>
        </section>
      </div>

      {/* Refund */}
      <Modal open={refundOpen} onClose={() => !busy && setRefundOpen(false)} title="Refund sale" description={sale.paymentKind === "CARD" ? "The card will be refunded through Square." : sale.paymentKind === "CREDIT" ? "The amount is returned to the member's credit balance." : sale.paymentKind === "GIFT_CARD" ? "The amount is returned to the gift card." : "Cash / external refunds are recorded only — hand the money back."}
        footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={() => setRefundOpen(false)} disabled={busy}>Cancel</Button><Button variant="danger" loading={busy} onClick={() => void act("refund", { lineItemIds: lineIds.size ? [...lineIds] : undefined, reason }, "Refund recorded")}>Refund {formatMoney(selectedAmount)}</Button></div>}>
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-apple-xs font-medium text-apple-text-secondary">Items (leave all unchecked for a full refund)</div>
            <ul className="divide-y divide-apple-divider rounded-apple border border-apple-border">
              {sale.lineItems.map((li) => {
                const done = refundedLineIds.has(li.id);
                return (
                  <li key={li.id} className={["flex items-center gap-3 px-3 py-2 text-apple-sm", done ? "opacity-50" : ""].join(" ")}>
                    <input type="checkbox" className="h-4 w-4 accent-apple-blue" disabled={done} checked={lineIds.has(li.id)} onChange={(e) => setLineIds((s) => { const n = new Set(s); if (e.target.checked) n.add(li.id); else n.delete(li.id); return n; })} />
                    <span className="flex-1 truncate">{li.description}</span>
                    <span className="tabular-nums">{formatMoney(li.totalCents)}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1 text-apple-xs text-apple-text-tertiary">Discount and tax are refunded proportionally. Inventory is restored for product lines.</p>
          </div>
          <Textarea label="Reason (optional)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Modal>

      {/* Void */}
      <Modal open={voidOpen} onClose={() => !busy && setVoidOpen(false)} title={`Void sale #${sale.number}?`} description="Same-day only. Reverses the payment (where possible), restores inventory, and marks the sale void."
        footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={() => setVoidOpen(false)} disabled={busy}>Keep</Button><Button variant="danger" loading={busy} onClick={() => void act("void", { reason }, "Sale voided")}>Void sale</Button></div>}>
        <Textarea label="Reason (optional)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </Drawer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-apple-text-secondary"><dt>{label}</dt><dd className="tabular-nums text-apple-text">{value}</dd></div>;
}
