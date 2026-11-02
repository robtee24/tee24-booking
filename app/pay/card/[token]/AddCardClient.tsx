"use client";

import React from "react";
import { Card, CardHeader } from "@/components/ui";
import { CardForm } from "@/components/payments/CardForm";
import type { SquarePublicConfig } from "@/lib/square";
import { CheckCircle2, CreditCard } from "lucide-react";

type Props = {
  token: string;
  square: SquarePublicConfig;
  member: { firstName: string; lastName: string; email: string; phone: string; zip: string | null };
  existing: { brand: string | null; last4: string | null } | null;
  location: { name: string; logoUrl: string | null; phone: string | null; email: string | null };
};

export function AddCardClient({ token, square, member, existing, location }: Props) {
  const [saved, setSaved] = React.useState<{ brand: string | null; last4: string | null } | null>(null);

  async function save(payload: { sourceId: string; verificationToken: string | null }) {
    const res = await fetch(`/api/pay/card/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Could not save card");
    setSaved(json.card ?? { brand: null, last4: null });
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
            <p className="text-apple-sm text-apple-text-secondary">Card on file</p>
          </div>
        </header>

        <Card>
          <CardHeader
            title={saved ? "Card saved" : `Hi ${member.firstName}`}
            subtitle={saved ? "You're set. Head back to the Tee24 app — your league entry will charge this card." : existing ? `Your current card ending ${existing.last4 ?? "····"} will be replaced as the default.` : "Add a card so your $10 weekly league entry can be charged when you submit a score at the bay."}
          />
          {saved ? (
            <div className="mt-4 flex items-center gap-2 rounded-apple-sm bg-apple-green/10 p-3 text-apple-sm text-apple-green">
              <CheckCircle2 className="h-5 w-5" /> {saved.brand ?? "Card"} ending {saved.last4 ?? "····"} is now your default payment method.
            </div>
          ) : square.configured ? (
            <div className="mt-4">
              <CardForm
                square={square}
                intent="STORE"
                billingContact={{ givenName: member.firstName, familyName: member.lastName, email: member.email, phone: member.phone, postalCode: member.zip ?? undefined }}
                onToken={save}
                buttonLabel={
                  <>
                    <CreditCard className="mr-2 h-4 w-4" /> Save card
                  </>
                }
              />
              <p className="mt-3 text-apple-xs text-apple-text-tertiary">Your card is stored securely with Square. Tee24 never sees the full number.</p>
            </div>
          ) : (
            <div className="mt-4 rounded-apple-sm border border-apple-border bg-apple-fill-secondary p-4 text-apple-sm text-apple-text-secondary">
              Online card entry isn&apos;t available yet. Please contact the front desk
              {location.phone ? <> — call <a className="text-apple-blue" href={`tel:${location.phone}`}>{location.phone}</a></> : null}.
            </div>
          )}
        </Card>

        <p className="mt-6 text-center text-apple-xs text-apple-text-tertiary">
          Questions? {location.email ? <a className="text-apple-blue" href={`mailto:${location.email}`}>{location.email}</a> : "Contact the front desk."}
        </p>
      </div>
    </div>
  );
}
