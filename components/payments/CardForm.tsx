"use client";
/**
 * Shared Square card entry form.
 *
 * Mounts the Web Payments SDK card element, tokenizes on submit and (when an
 * amount or STORE intent is given) runs buyer verification (SCA / 3DS). Calls
 * `onToken` with the `sourceId` nonce + optional `verificationToken`; the
 * caller then POSTs to a server route that creates the payment / card on file.
 *
 * Used by: admin invoice detail, member portal, public signup, day pass, hosted pay page.
 */
import React from "react";
import { Button } from "@/components/ui";
import { centsToSquareAmount, useSquarePayments, type SquareCardInstance, type SquareVerifyBuyerDetails } from "@/lib/square-web";
import type { SquarePublicConfig } from "@/lib/square";

export type CardTokenDetails = {
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
};

export type CardFormProps = {
  square: SquarePublicConfig;
  /** CHARGE: one-off payment (amountCents required for verification). STORE: vaulting a card. */
  intent?: "CHARGE" | "STORE";
  amountCents?: number;
  currency?: string;
  billingContact?: SquareVerifyBuyerDetails["billingContact"];
  /** Called with the tokenized card. Return a rejected promise / throw to show an error. */
  onToken: (payload: { sourceId: string; verificationToken: string | null; card: CardTokenDetails }) => Promise<void> | void;
  buttonLabel?: React.ReactNode;
  submitting?: boolean;
  disabled?: boolean;
  /** Skip buyer verification (e.g. admin keyed-in entry where SCA isn't required). */
  skipVerification?: boolean;
  className?: string;
  /** Render extra content between the card element and the submit button. */
  children?: React.ReactNode;
};

export function CardForm({
  square,
  intent = "CHARGE",
  amountCents,
  currency = "USD",
  billingContact,
  onToken,
  buttonLabel,
  submitting,
  disabled,
  skipVerification,
  className = "",
  children,
}: CardFormProps) {
  const containerId = React.useId().replace(/:/g, "_");
  const { payments, error: sdkError, loading } = useSquarePayments({
    applicationId: square.applicationId,
    locationId: square.locationId,
    sdkUrl: square.sdkUrl,
    enabled: square.configured,
  });
  const cardRef = React.useRef<SquareCardInstance | null>(null);
  const [ready, setReady] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!payments) return;
    let cancelled = false;
    let instance: SquareCardInstance | null = null;
    (async () => {
      try {
        instance = await payments.card();
        if (cancelled) {
          await instance.destroy().catch(() => {});
          return;
        }
        await instance.attach(`#${containerId}`);
        cardRef.current = instance;
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not initialise the card form");
      }
    })();
    return () => {
      cancelled = true;
      setReady(false);
      const inst = cardRef.current ?? instance;
      cardRef.current = null;
      if (inst) void inst.destroy().catch(() => {});
    };
  }, [payments, containerId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cardRef.current || !payments) return;
    setBusy(true);
    setError(null);
    try {
      const result = await cardRef.current.tokenize();
      if (result.status !== "OK" || !result.token) {
        const msg = result.errors?.map((x) => x.message).filter(Boolean).join(" ") || "Card could not be verified. Check the details and try again.";
        throw new Error(msg);
      }
      let verificationToken: string | null = null;
      if (!skipVerification) {
        try {
          const details: SquareVerifyBuyerDetails = {
            intent,
            billingContact: billingContact ?? {},
            ...(intent === "CHARGE" && amountCents != null
              ? { amount: centsToSquareAmount(amountCents), currencyCode: currency }
              : {}),
          };
          const v = await payments.verifyBuyer(result.token, details);
          verificationToken = v?.token ?? null;
        } catch (verr) {
          // Verification is best-effort unless the issuer requires it; Square
          // will reject the payment server-side if a token was mandatory.
          console.warn("[CardForm] verifyBuyer failed", verr);
        }
      }
      await onToken({
        sourceId: result.token,
        verificationToken,
        card: {
          brand: result.details?.card?.brand,
          last4: result.details?.card?.last4,
          expMonth: result.details?.card?.expMonth,
          expYear: result.details?.card?.expYear,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  if (!square.configured) {
    return (
      <div className={["rounded-apple-sm border border-dashed border-apple-border bg-apple-fill-secondary p-4 text-apple-sm text-apple-text-secondary", className].join(" ")}>
        Card payments aren&apos;t available online right now. Please contact the front desk to complete your payment.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={["space-y-4", className].join(" ")}>
      <div
        id={containerId}
        className="min-h-[56px] rounded-apple-sm border border-apple-border bg-white px-2 py-1"
        aria-busy={loading || !ready}
      />
      {(loading || (!ready && !sdkError && !error)) && (
        <p className="text-apple-xs text-apple-text-tertiary">Loading secure card form…</p>
      )}
      {children}
      {(sdkError || error) && (
        <p role="alert" className="text-apple-sm text-apple-red">
          {sdkError ?? error}
        </p>
      )}
      <Button type="submit" className="w-full" loading={busy || submitting} disabled={disabled || !ready || Boolean(sdkError)}>
        {buttonLabel ?? (intent === "STORE" ? "Save card" : "Pay now")}
      </Button>
      <p className="text-center text-apple-xs text-apple-text-tertiary">
        Secured by Square. Card details never touch our servers.
      </p>
    </form>
  );
}
