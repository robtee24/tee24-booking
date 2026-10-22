"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Modal, Money, Select, Textarea, useToast } from "@/components/ui";
import { CardForm } from "@/components/payments/CardForm";
import type { SquarePublicConfig } from "@/lib/square";
import { Banknote, Ban, CreditCard, Link2, Mail, Pencil, Plus, RotateCcw, Send, Tag, Check } from "lucide-react";

export type InvoiceActionsProps = {
  invoice: {
    id: string;
    number: number;
    status: string;
    description: string | null;
    dueDate: string;
    adminNotes: string | null;
    totalCents: number;
    refundedCents: number;
    surchargeCents: number;
    payUrl: string | null;
    memberEmail: string;
  };
  paymentMethods: Array<{ id: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; isDefault: boolean; status: string }>;
  charges: Array<{ id: string; status: string; amountCents: number; refundedCents: number; squarePaymentId: string | null }>;
  creditBalanceCents: number;
  currency: string;
  square: SquarePublicConfig;
};

type ModalKind = "charge" | "mark-paid" | "write-off" | "refund" | "pay-link" | "discount" | "add-line" | "edit" | null;

const PAID = ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"];
const OPEN = ["SCHEDULED", "PAST_DUE", "FAILED"];

export function InvoiceActions({ invoice, paymentMethods, charges, creditBalanceCents, currency, square }: InvoiceActionsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [modal, setModal] = React.useState<ModalKind>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  // form state
  const [pmId, setPmId] = React.useState(paymentMethods.find((p) => p.isDefault)?.id ?? paymentMethods[0]?.id ?? "");
  const [useNewCard, setUseNewCard] = React.useState(paymentMethods.length === 0);
  const [method, setMethod] = React.useState("CASH");
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [refundChargeId, setRefundChargeId] = React.useState(charges.find((c) => c.status === "SUCCEEDED" || c.status === "PARTIALLY_REFUNDED")?.id ?? "");
  const [asCredit, setAsCredit] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [lineDesc, setLineDesc] = React.useState("");
  const [lineAmount, setLineAmount] = React.useState("");
  const [edit, setEdit] = React.useState({ description: invoice.description ?? "", dueDate: invoice.dueDate.slice(0, 10), adminNotes: invoice.adminNotes ?? "" });

  const remaining = invoice.totalCents - invoice.refundedCents;
  const isOpen = OPEN.includes(invoice.status);
  const isPaid = PAID.includes(invoice.status);
  const refundable = charges.filter((c) => (c.status === "SUCCEEDED" || c.status === "PARTIALLY_REFUNDED") && c.amountCents - c.refundedCents > 0);
  const refundTarget = refundable.find((c) => c.id === refundChargeId);

  async function act(action: string, body: Record<string, unknown> = {}, successTitle?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/invoices/${invoice.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Request failed");
      toast({ tone: "success", title: successTitle ?? "Done" });
      setModal(null);
      setNote("");
      setAmount("");
      router.refresh();
      return json;
    } catch (e) {
      toast({ tone: "error", title: "Action failed", description: e instanceof Error ? e.message : undefined });
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/invoices/${invoice.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Request failed");
      toast({ tone: "success", title: "Invoice updated" });
      setModal(null);
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Update failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  function copyPayLink() {
    if (!invoice.payUrl) return;
    navigator.clipboard?.writeText(invoice.payUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {isOpen && (
          <>
            <Button iconLeft={<CreditCard className="h-4 w-4" />} onClick={() => setModal("charge")} disabled={!square.configured} title={square.configured ? undefined : "Connect Square to charge cards"}>
              Charge card
            </Button>
            <Button variant="secondary" iconLeft={<Banknote className="h-4 w-4" />} onClick={() => setModal("mark-paid")}>Mark paid</Button>
            <Button variant="secondary" iconLeft={<Tag className="h-4 w-4" />} onClick={() => setModal("discount")}>Apply discount</Button>
            <Button variant="secondary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setModal("add-line")}>Add line</Button>
            <Button variant="secondary" iconLeft={<Send className="h-4 w-4" />} onClick={() => setModal("pay-link")}>Send pay link</Button>
            {invoice.payUrl && (
              <Button variant="secondary" iconLeft={copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />} onClick={copyPayLink}>{copied ? "Copied" : "Copy pay link"}</Button>
            )}
            <Button variant="danger" iconLeft={<Ban className="h-4 w-4" />} onClick={() => setModal("write-off")}>Write off</Button>
          </>
        )}
        {isPaid && (
          <>
            {refundable.length > 0 && <Button variant="secondary" iconLeft={<RotateCcw className="h-4 w-4" />} onClick={() => setModal("refund")}>Refund</Button>}
            <Button variant="secondary" iconLeft={<Mail className="h-4 w-4" />} loading={busy && modal === null} onClick={() => act("send-receipt", {}, `Receipt sent to ${invoice.memberEmail}`).catch(() => {})}>Resend receipt</Button>
          </>
        )}
        <Button variant="ghost" iconLeft={<Pencil className="h-4 w-4" />} onClick={() => setModal("edit")}>Edit</Button>
      </div>

      {/* Charge card */}
      <Modal
        open={modal === "charge"}
        onClose={() => setModal(null)}
        title={`Charge ${formatMoney(remaining, currency)}`}
        description="Charges the remaining balance now. Successful payments activate the membership and email a receipt."
        footer={
          useNewCard ? undefined : (
            <>
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button loading={busy} disabled={!pmId} onClick={() => act("charge", { paymentMethodId: pmId }, "Payment succeeded").catch(() => {})}>Charge card on file</Button>
            </>
          )
        }
      >
        {paymentMethods.length > 0 && (
          <div className="mb-3 flex gap-2 text-apple-sm">
            <button type="button" className={`rounded-apple-pill px-3 py-1 ${!useNewCard ? "bg-apple-blue text-white" : "bg-apple-fill-secondary text-apple-text"}`} onClick={() => setUseNewCard(false)}>Card on file</button>
            <button type="button" className={`rounded-apple-pill px-3 py-1 ${useNewCard ? "bg-apple-blue text-white" : "bg-apple-fill-secondary text-apple-text"}`} onClick={() => setUseNewCard(true)}>New card</button>
          </div>
        )}
        {!useNewCard ? (
          <Select label="Payment method" value={pmId} onChange={(e) => setPmId(e.target.value)}>
            {paymentMethods.map((p) => (
              <option key={p.id} value={p.id} disabled={p.status === "EXPIRED"}>
                {p.brand ?? "Card"} •••• {p.last4} · {String(p.expMonth ?? "").padStart(2, "0")}/{p.expYear}{p.isDefault ? " (default)" : ""}{p.status !== "ACTIVE" ? ` · ${p.status}` : ""}
              </option>
            ))}
          </Select>
        ) : (
          <CardForm
            square={square}
            intent="CHARGE"
            amountCents={remaining}
            currency={currency}
            skipVerification
            buttonLabel={<>Charge <Money cents={remaining} currency={currency} /></>}
            onToken={({ sourceId, verificationToken }) => act("charge-nonce", { sourceId, verificationToken }, "Payment succeeded").then(() => undefined)}
          />
        )}
      </Modal>

      {/* Mark paid */}
      <Modal
        open={modal === "mark-paid"}
        onClose={() => setModal(null)}
        title="Mark as paid"
        description={`Records an offline payment. ${invoice.surchargeCents > 0 ? "The card surcharge is removed for non-card payments." : ""}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button loading={busy} onClick={() => act("mark-paid", { method, amountCents: amount ? Math.round(Number(amount) * 100) : undefined, note }, "Marked as paid").catch(() => {})}>Mark paid</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Select label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CASH">Cash</option>
            <option value="CHECK">Check</option>
            <option value="OTHER">Other</option>
            <option value="CREDIT" disabled={creditBalanceCents <= 0}>Account credit ({formatMoney(creditBalanceCents, currency)} available)</option>
          </Select>
          <Input label="Amount (optional — defaults to full balance)" type="number" step="0.01" min={0} prefix="$" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(Math.max(0, remaining - invoice.surchargeCents) / 100).toFixed(2)} />
          <Textarea label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Modal>

      {/* Write off */}
      <Modal
        open={modal === "write-off"}
        onClose={() => setModal(null)}
        title="Write off invoice"
        description="Cancels this invoice. The member will not be charged, and any overdue access block is lifted."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={() => act("write-off", { reason: note }, "Invoice written off").catch(() => {})}>Write off</Button>
          </>
        }
      >
        <Textarea label="Reason (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>

      {/* Refund */}
      <Modal
        open={modal === "refund"}
        onClose={() => setModal(null)}
        title="Refund"
        description="Refund to the original card via Square, or issue account credit the member can use on future invoices."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={!refundTarget || !amount || Number(amount) <= 0}
              onClick={() => act("refund", { chargeId: refundChargeId, amountCents: Math.round(Number(amount) * 100), reason: note, asCredit }, "Refund issued").catch(() => {})}
            >
              Refund {amount ? formatMoney(Math.round(Number(amount) * 100), currency) : ""}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {refundable.length > 1 && (
            <Select label="Charge" value={refundChargeId} onChange={(e) => setRefundChargeId(e.target.value)}>
              {refundable.map((c) => (
                <option key={c.id} value={c.id}>{formatMoney(c.amountCents - c.refundedCents, currency)} available · {c.squarePaymentId ?? "manual"}</option>
              ))}
            </Select>
          )}
          <Input
            label={`Amount (up to ${formatMoney((refundTarget?.amountCents ?? 0) - (refundTarget?.refundedCents ?? 0), currency)})`}
            type="number"
            step="0.01"
            min={0}
            prefix="$"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Button variant="link" size="sm" onClick={() => setAmount((((refundTarget?.amountCents ?? 0) - (refundTarget?.refundedCents ?? 0)) / 100).toFixed(2))}>Refund full amount</Button>
          <label className="flex items-center gap-2 text-apple-sm text-apple-text">
            <input type="checkbox" className="h-4 w-4 accent-apple-blue" checked={asCredit} onChange={(e) => setAsCredit(e.target.checked)} />
            Issue as account credit instead of refunding the card
          </label>
          {!asCredit && refundTarget && !refundTarget.squarePaymentId && (
            <p className="text-apple-xs text-apple-orange">This was an offline payment — the refund will be recorded for accounting, but you must return the money manually.</p>
          )}
          <Textarea label="Reason (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Modal>

      {/* Send pay link */}
      <Modal
        open={modal === "pay-link"}
        onClose={() => setModal(null)}
        title="Send pay link"
        description={`Emails ${invoice.memberEmail} a secure link to pay this invoice online${square.configured ? "" : " (online card payment is unavailable until Square is connected; the page will show front-desk instructions)"}.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button loading={busy} onClick={() => act("send-pay-link", { message: note }, "Pay link sent").catch(() => {})}>Send email</Button>
          </>
        }
      >
        <Textarea label="Personal message (optional)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>

      {/* Apply discount */}
      <Modal
        open={modal === "discount"}
        onClose={() => setModal(null)}
        title="Apply discount code"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button loading={busy} disabled={!code.trim()} onClick={() => act("apply-discount", { code: code.trim() }, "Discount applied").catch(() => {})}>Apply</Button>
          </>
        }
      >
        <Input label="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoFocus />
      </Modal>

      {/* Add line */}
      <Modal
        open={modal === "add-line"}
        onClose={() => setModal(null)}
        title="Add line item"
        description="Totals (tax, surcharge) are recalculated."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button loading={busy} disabled={!lineDesc.trim() || !lineAmount} onClick={() => act("add-line", { description: lineDesc, unitCents: Math.round(Number(lineAmount) * 100), quantity: 1 }, "Line added").then(() => { setLineDesc(""); setLineAmount(""); }).catch(() => {})}>Add</Button>
          </>
        }
      >
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Input label="Description" value={lineDesc} onChange={(e) => setLineDesc(e.target.value)} />
          <Input label="Amount" type="number" step="0.01" prefix="$" value={lineAmount} onChange={(e) => setLineAmount(e.target.value)} />
        </div>
      </Modal>

      {/* Edit */}
      <Modal
        open={modal === "edit"}
        onClose={() => setModal(null)}
        title={`Edit invoice #${invoice.number}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button loading={busy} onClick={() => patch({ description: edit.description, dueDate: edit.dueDate, adminNotes: edit.adminNotes })}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="Description" value={edit.description} onChange={(e) => setEdit((s) => ({ ...s, description: e.target.value }))} />
          <Input label="Due date" type="date" value={edit.dueDate} disabled={!isOpen} onChange={(e) => setEdit((s) => ({ ...s, dueDate: e.target.value }))} />
          <Textarea label="Internal notes (not visible to member)" rows={3} value={edit.adminNotes} onChange={(e) => setEdit((s) => ({ ...s, adminNotes: e.target.value }))} />
        </div>
      </Modal>
    </>
  );
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}
