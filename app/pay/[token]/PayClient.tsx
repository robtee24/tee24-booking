"use client";

import React from "react";
import { Button, Card, CardHeader, Input, Money, StatusBadge } from "@/components/ui";
import { CardForm } from "@/components/payments/CardForm";
import type { SquarePublicConfig } from "@/lib/square";
import { CheckCircle2 } from "lucide-react";

type InvoiceView = {
  number: number;
  status: string;
  description: string | null;
  dueDate: string;
  paidAt: string | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  surchargeCents: number;
  totalCents: number;
  remainingCents: number;
  currency: string;
  lineItems: Array<{ id: string; description: string; quantity: number; totalCents: number }>;
  planName: string | null;
  payable: boolean;
};

type Props = {
  token: string;
  square: SquarePublicConfig;
  invoice: InvoiceView;
  member: { firstName: string; lastName: string; email: string; phone: string; zip: string | null };
  location: { name: string; logoUrl: string | null; phone: string | null; email: string | null };
};

export function PayClient({ token, square, invoice: initial, member, location }: Props) {
  const [invoice, setInvoice] = React.useState<InvoiceView>(initial);
  const [paid, setPaid] = React.useState(!initial.payable && (initial.status === "PAID" || initial.status === "PARTIALLY_REFUNDED"));
  const [code, setCode] = React.useState("");
  const [codeMsg, setCodeMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [applying, setApplying] = React.useState(false);

  async function applyCode() {
    if (!code.trim()) return;
    setApplying(true);
    setCodeMsg(null);
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply-discount", code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Invalid code");
      if (json.invoice) setInvoice((prev) => ({ ...prev, ...json.invoice }));
      setCodeMsg({ tone: "ok", text: json.amountCents > 0 ? `Code ${json.code} applied — you save ${fmt(json.amountCents, invoice.currency)}.` : `Code ${json.code} doesn't reduce this invoice.` });
    } catch (e) {
      setCodeMsg({ tone: "err", text: e instanceof Error ? e.message : "Invalid code" });
    } finally {
      setApplying(false);
    }
  }

  async function pay(payload: { sourceId: string; verificationToken: string | null }) {
    const res = await fetch(`/api/pay/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Payment failed");
    if (json.invoice) setInvoice((prev) => ({ ...prev, ...json.invoice }));
    setPaid(true);
  }

  return (
    <div className="min-h-screen bg-apple-bg py-10">
      <div className="mx-auto max-w-lg px-4">
        <header className="mb-6 flex items-center gap-3">
          {location.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={location.logoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
          ) : null}
          <div>
            <h1 className="text-apple-xl font-semibold tracking-tight text-apple-text">{location.name}</h1>
            <p className="text-apple-sm text-apple-text-secondary">Invoice #{invoice.number}</p>
          </div>
        </header>

        <Card>
          <CardHeader
            title={paid ? "Thank you!" : `Hi ${member.firstName}`}
            subtitle={paid ? "Your payment was received. A receipt is on its way to your email." : invoice.payable ? `Due ${new Date(invoice.dueDate).toLocaleDateString()}` : "This invoice is not currently payable."}
            action={<StatusBadge status={paid ? "PAID" : invoice.status} size="sm" />}
          />
          {paid && (
            <div className="mt-4 flex items-center gap-2 rounded-apple-sm bg-apple-green/10 p-3 text-apple-sm text-apple-green">
              <CheckCircle2 className="h-5 w-5" /> Paid {fmt(invoice.totalCents, invoice.currency)}
            </div>
          )}

          <dl className="mt-4 space-y-2 text-apple-sm">
            {invoice.description && <Row label="For" value={invoice.description} />}
            {invoice.lineItems.map((l) => (
              <Row key={l.id} label={`${l.description}${l.quantity > 1 ? ` × ${l.quantity}` : ""}`} value={<Money cents={l.totalCents} currency={invoice.currency} />} />
            ))}
            {invoice.discountCents > 0 && <Row label="Discount" value={<span className="text-apple-green">−<Money cents={invoice.discountCents} currency={invoice.currency} /></span>} />}
            {invoice.taxCents > 0 && <Row label="Tax" value={<Money cents={invoice.taxCents} currency={invoice.currency} />} />}
            {invoice.surchargeCents > 0 && <Row label="Card surcharge" value={<Money cents={invoice.surchargeCents} currency={invoice.currency} />} />}
            <div className="my-2 border-t border-apple-divider" />
            <Row label={paid ? "Total paid" : "Total due"} value={<span className="text-apple-lg font-semibold text-apple-text"><Money cents={paid ? invoice.totalCents : invoice.remainingCents} currency={invoice.currency} /></span>} />
          </dl>
        </Card>

        {!paid && invoice.payable && (
          <Card className="mt-4">
            <CardHeader title="Pay by card" />
            {square.configured ? (
              <>
                <div className="mt-4 flex items-end gap-2">
                  <Input label="Discount code (optional)" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" />
                  <Button variant="secondary" onClick={applyCode} loading={applying} disabled={!code.trim()}>Apply</Button>
                </div>
                {codeMsg && <p className={`mt-1 text-apple-xs ${codeMsg.tone === "ok" ? "text-apple-green" : "text-apple-red"}`}>{codeMsg.text}</p>}
                <div className="mt-4">
                  <CardForm
                    square={square}
                    intent="CHARGE"
                    amountCents={invoice.remainingCents}
                    currency={invoice.currency}
                    billingContact={{ givenName: member.firstName, familyName: member.lastName, email: member.email, phone: member.phone, postalCode: member.zip ?? undefined }}
                    onToken={pay}
                    buttonLabel={<>Pay <Money cents={invoice.remainingCents} currency={invoice.currency} /></>}
                  />
                </div>
              </>
            ) : (
              <div className="mt-4 rounded-apple-sm border border-apple-border bg-apple-fill-secondary p-4 text-apple-sm text-apple-text-secondary">
                Online card payments aren&apos;t available yet. Please contact the front desk to pay this invoice
                {location.phone ? <> — call <a className="text-apple-blue" href={`tel:${location.phone}`}>{location.phone}</a></> : null}
                {location.email ? <> or email <a className="text-apple-blue" href={`mailto:${location.email}`}>{location.email}</a></> : null}.
              </div>
            )}
          </Card>
        )}

        <p className="mt-6 text-center text-apple-xs text-apple-text-tertiary">
          Questions? {location.email ? <a className="text-apple-blue" href={`mailto:${location.email}`}>{location.email}</a> : "Contact the front desk."}
        </p>
      </div>
    </div>
  );
}

function fmt(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-apple-text-secondary">{label}</dt>
      <dd className="text-right font-medium text-apple-text">{value}</dd>
    </div>
  );
}
