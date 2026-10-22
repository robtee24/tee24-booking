"use client";
/**
 * Portal billing interactivity: manage cards on file + pay open invoices.
 * Everything else on /portal/billing stays server-rendered.
 */
import React from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, Money, StatusBadge } from "@/components/ui";
import { CardForm } from "@/components/payments/CardForm";
import type { SquarePublicConfig } from "@/lib/square";
import { CreditCard, Plus, Star, Trash2 } from "lucide-react";

export type PortalCard = { id: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; isDefault: boolean; status: string };

export function PortalCardManager({
  square,
  cards: initial,
  member,
  readOnly,
}: {
  square: SquarePublicConfig;
  cards: PortalCard[];
  member: { firstName: string; lastName: string; email: string; phone: string; zip: string | null };
  readOnly: boolean;
}) {
  const router = useRouter();
  const [cards, setCards] = React.useState(initial);
  const [open, setOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function addCard(payload: { sourceId: string; verificationToken: string | null }) {
    const res = await fetch("/api/portal/billing/card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, setDefault: true }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Could not save card");
    setCards(json.paymentMethods ?? []);
    setOpen(false);
    router.refresh();
  }

  async function makeDefault(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/portal/billing/card", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not update card");
      setCards(json.paymentMethods ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update card");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this card?")) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/portal/billing/card?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not remove card");
      setCards(json.paymentMethods ?? []);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove card");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-4 space-y-2">
      {cards.length === 0 ? (
        <p className="text-apple-sm text-apple-text-tertiary">No card on file.</p>
      ) : (
        cards.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-apple-sm border border-apple-divider px-3 py-2 text-apple-sm">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-apple-text-tertiary" />
              <span className="font-medium text-apple-text">{m.brand} •••• {m.last4}</span>
              <span className="text-apple-xs text-apple-text-tertiary">Exp {String(m.expMonth ?? 0).padStart(2, "0")}/{m.expYear}</span>
              {m.isDefault && <span className="rounded-full bg-apple-blue/10 px-2 py-0.5 text-[10px] font-medium text-apple-blue">Default</span>}
              {m.status !== "ACTIVE" && <StatusBadge status={m.status} size="sm" />}
            </div>
            {!readOnly && (
              <div className="flex items-center gap-1">
                {!m.isDefault && (
                  <Button size="sm" variant="ghost" iconLeft={<Star className="h-3.5 w-3.5" />} loading={busyId === m.id} onClick={() => makeDefault(m.id)}>Make default</Button>
                )}
                <Button size="sm" variant="ghost" iconLeft={<Trash2 className="h-3.5 w-3.5" />} loading={busyId === m.id} onClick={() => remove(m.id)}>Remove</Button>
              </div>
            )}
          </div>
        ))
      )}
      {error && <p className="text-apple-xs text-apple-red">{error}</p>}
      {!readOnly && square.configured && (
        <Button size="sm" variant="secondary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
          {cards.length ? "Add / replace card" : "Add a card"}
        </Button>
      )}
      {!square.configured && <p className="text-apple-xs text-apple-text-tertiary">Online card management isn&apos;t available yet — contact the front desk to update your card.</p>}

      <Modal open={open} onClose={() => setOpen(false)} title="Add a card" description="Your new card becomes the default for upcoming payments.">
        <CardForm
          square={square}
          intent="STORE"
          billingContact={{ givenName: member.firstName, familyName: member.lastName, email: member.email, phone: member.phone, postalCode: member.zip ?? undefined }}
          onToken={addCard}
          buttonLabel="Save card"
        />
      </Modal>
    </div>
  );
}

export function PortalPayButton({
  invoice,
  square,
  hasCard,
  member,
  readOnly,
}: {
  invoice: { id: string; number: number; remainingCents: number; currency: string };
  square: SquarePublicConfig;
  hasCard: boolean;
  member: { firstName: string; lastName: string; email: string; phone: string; zip: string | null };
  readOnly: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  async function payWithCardOnFile() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/billing/pay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId: invoice.id }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Payment failed");
      setDone(true);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  async function payWithNewCard(payload: { sourceId: string; verificationToken: string | null }) {
    const res = await fetch("/api/portal/billing/pay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId: invoice.id, ...payload }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Payment failed");
    setDone(true);
    setOpen(false);
    router.refresh();
  }

  if (readOnly || !square.configured) return null;
  if (done) return <span className="text-apple-xs text-apple-green">Paid</span>;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Pay now</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Pay invoice #${invoice.number}`} description={`Amount due: ${new Intl.NumberFormat("en-US", { style: "currency", currency: invoice.currency }).format(invoice.remainingCents / 100)}`}>
        {hasCard && (
          <div className="mb-4 rounded-apple-sm border border-apple-divider p-3">
            <p className="text-apple-sm text-apple-text">Use your card on file</p>
            <Button className="mt-2 w-full" loading={busy} onClick={payWithCardOnFile}>Pay <Money cents={invoice.remainingCents} currency={invoice.currency} /> with saved card</Button>
            {error && <p className="mt-2 text-apple-xs text-apple-red">{error}</p>}
            <p className="mt-3 text-center text-apple-xs text-apple-text-tertiary">— or enter a different card —</p>
          </div>
        )}
        <CardForm
          square={square}
          intent="CHARGE"
          amountCents={invoice.remainingCents}
          currency={invoice.currency}
          billingContact={{ givenName: member.firstName, familyName: member.lastName, email: member.email, phone: member.phone, postalCode: member.zip ?? undefined }}
          onToken={payWithNewCard}
          buttonLabel={<>Pay <Money cents={invoice.remainingCents} currency={invoice.currency} /></>}
        />
      </Modal>
    </>
  );
}
