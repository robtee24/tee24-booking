// components/admin/sales/CardSlot.tsx
"use client";
/**
 * Card-entry seam for the New Sale screen.
 *
 * Square is not configured in production yet, and the shared
 * `components/payments/CardForm.tsx` (Web Payments SDK) is being built by the
 * billing worker. This slot keeps the integration surface stable:
 *
 *   <CardSlot
 *     ready={ctx.squareReady}          // from GET /api/admin/sales/context
 *     amountCents={totals.totalCents}
 *     sourceId={sourceId}              // card nonce once tokenised
 *     onSourceId={setSourceId}         // CardForm → onToken(nonce) wires here
 *   >
 *     {ready && <CardForm amountCents={…} onToken={onSourceId} />}   ← drop-in later
 *   </CardSlot>
 *
 * When `ready` is false it renders the "configure SQUARE_* env" notice and
 * the sale cannot be completed with a card. When `ready` is true and no
 * `children` is supplied it renders a plain token input so a nonce from the
 * Square sandbox can be pasted for testing.
 */
import React from "react";
import { CreditCard, ShieldAlert } from "lucide-react";
import { Input, formatMoney } from "@/components/ui";

export type CardSlotProps = {
  /** `squareReady()` from the server — SQUARE_ACCESS_TOKEN + SQUARE_LOCATION_ID present. */
  ready: boolean;
  amountCents: number;
  currency?: string;
  /** Current card token (Square `sourceId`), or null until the card form tokenises. */
  sourceId: string | null;
  onSourceId: (sourceId: string | null) => void;
  /** Optional shared card form (e.g. `components/payments/CardForm`). It should call `onSourceId` with the nonce. */
  children?: React.ReactNode;
};

export function CardSlot({ ready, amountCents, currency = "USD", sourceId, onSourceId, children }: CardSlotProps) {
  if (!ready) {
    return (
      <div className="flex items-start gap-3 rounded-apple border border-apple-orange/30 bg-apple-orange/5 p-4 text-apple-sm text-apple-text">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-apple-orange" />
        <div>
          <div className="font-medium">Card entry requires Square — configure SQUARE_* env</div>
          <div className="mt-0.5 text-apple-xs text-apple-text-secondary">
            Set <code>SQUARE_ACCESS_TOKEN</code> and <code>SQUARE_LOCATION_ID</code> to accept cards here. Use “Other / external terminal” to record a card taken on a separate device.
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
      {children ?? (
        <Input
          label="Card token (sourceId)"
          placeholder="cnon:card-nonce-ok"
          value={sourceId ?? ""}
          onChange={(e) => onSourceId(e.target.value.trim() || null)}
          hint="Drop the shared CardForm into this slot; until then paste a Web Payments SDK nonce."
          autoComplete="off"
        />
      )}
      {sourceId && <p className="text-apple-xs text-apple-green">Card ready — complete the sale to charge.</p>}
    </div>
  );
}
