// components/admin/sales/CardSlot.tsx
"use client";
/**
 * Card entry for the New Sale screen.
 *
 * Renders the shared Square `CardForm` against the location's own Square
 * account (config comes from GET /api/admin/sales/context → `square`). When the
 * location has no Square connection (or no Web Payments application id) it
 * shows a notice pointing staff at Billing → Settings, and the sale cannot be
 * completed with a card.
 */
import React from "react";
import { Check, CreditCard, ShieldAlert } from "lucide-react";
import { Button, formatMoney } from "@/components/ui";
import { CardForm, type CardTokenDetails } from "@/components/payments/CardForm";
import type { SquarePublicConfigDTO } from "./types";

export type CardSlotProps = {
  /** Location has a Square connection with an application id. */
  ready: boolean;
  square: SquarePublicConfigDTO | null;
  amountCents: number;
  currency?: string;
  /** Current card token (Square `sourceId`), or null until the card form tokenises. */
  sourceId: string | null;
  onSourceId: (sourceId: string | null) => void;
};

export function CardSlot({ ready, square, amountCents, currency = "USD", sourceId, onSourceId }: CardSlotProps) {
  const [card, setCard] = React.useState<CardTokenDetails | null>(null);

  if (!ready || !square) {
    return (
      <div className="flex items-start gap-3 rounded-apple border border-apple-orange/30 bg-apple-orange/5 p-4 text-apple-sm text-apple-text">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-apple-orange" />
        <div>
          <div className="font-medium">Card entry needs this location&apos;s Square account</div>
          <div className="mt-0.5 text-apple-xs text-apple-text-secondary">
            Connect Square (access token, location and application ID) under Billing → Settings for this location. Use “Other / external terminal” to record a card taken on a separate device.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-apple border border-apple-border bg-white p-4">
      <div className="flex items-center justify-between text-apple-sm">
        <span className="inline-flex items-center gap-2 font-medium text-apple-text">
          <CreditCard className="h-4 w-4 text-apple-blue" /> Card payment
        </span>
        <span className="tabular-nums text-apple-text-secondary">{formatMoney(amountCents, currency)}</span>
      </div>
      {sourceId ? (
        <div className="flex items-center justify-between gap-3 rounded-apple-sm bg-apple-green/5 px-3 py-2 text-apple-sm">
          <span className="inline-flex items-center gap-2 text-apple-green">
            <Check className="h-4 w-4" />
            {card?.brand ?? "Card"} {card?.last4 ? `•••• ${card.last4}` : ""} ready — complete the sale to charge.
          </span>
          <Button size="sm" variant="secondary" onClick={() => { onSourceId(null); setCard(null); }}>
            Change card
          </Button>
        </div>
      ) : (
        <CardForm
          square={square}
          intent="CHARGE"
          amountCents={amountCents}
          currency={currency}
          skipVerification
          buttonLabel="Use this card"
          onToken={({ sourceId: token, card: details }) => {
            setCard(details);
            onSourceId(token);
          }}
        />
      )}
    </div>
  );
}
