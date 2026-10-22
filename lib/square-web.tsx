"use client";
/**
 * Square Web Payments SDK loader (browser).
 *
 * The SDK is loaded from Square's CDN via a <script> tag — there is no npm
 * package involved. `useSquarePayments()` resolves a `payments` instance once
 * the script is ready; `<CardForm />` in components/payments builds on it.
 *
 * Minimal type surface for the parts of the SDK we use.
 */
import React from "react";

export type SquareTokenResult = {
  status: "OK" | "Cancel" | "Error" | string;
  token?: string;
  errors?: Array<{ message?: string; field?: string; type?: string }>;
  details?: {
    card?: { brand?: string; last4?: string; expMonth?: number; expYear?: number };
    method?: string;
  };
};

export type SquareCardInstance = {
  attach: (selector: string | HTMLElement) => Promise<void>;
  tokenize: () => Promise<SquareTokenResult>;
  destroy: () => Promise<void>;
  addEventListener?: (event: string, cb: (e: unknown) => void) => void;
};

export type SquareVerifyBuyerDetails = {
  amount?: string; // "12.34"
  currencyCode?: string;
  intent: "CHARGE" | "STORE";
  billingContact?: {
    givenName?: string;
    familyName?: string;
    email?: string;
    phone?: string;
    addressLines?: string[];
    city?: string;
    state?: string;
    postalCode?: string;
    countryCode?: string;
  };
  customerInitiated?: boolean;
  sellerKeyedIn?: boolean;
};

export type SquarePaymentsInstance = {
  card: (opts?: Record<string, unknown>) => Promise<SquareCardInstance>;
  verifyBuyer: (token: string, details: SquareVerifyBuyerDetails) => Promise<{ token: string } | null>;
};

declare global {
  interface Window {
    Square?: {
      payments: (applicationId: string, locationId: string) => SquarePaymentsInstance;
    };
  }
}

const loaders = new Map<string, Promise<void>>();

/** Inject the SDK script once per URL and resolve when `window.Square` exists. */
export function loadSquareSdk(sdkUrl: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Square SDK can only load in the browser"));
  if (window.Square) return Promise.resolve();
  const existing = loaders.get(sdkUrl);
  if (existing) return existing;

  const p = new Promise<void>((resolve, reject) => {
    const el = document.querySelector<HTMLScriptElement>(`script[src="${sdkUrl}"]`);
    if (el && window.Square) return resolve();
    const script = el ?? document.createElement("script");
    if (!el) {
      script.src = sdkUrl;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => (window.Square ? resolve() : reject(new Error("Square SDK did not initialise"))));
    script.addEventListener("error", () => reject(new Error("Failed to load the Square payment form")));
  });
  loaders.set(sdkUrl, p);
  return p;
}

export type UseSquarePaymentsArgs = {
  applicationId: string | null;
  locationId: string | null;
  sdkUrl: string;
  enabled?: boolean;
};

export function useSquarePayments({ applicationId, locationId, sdkUrl, enabled = true }: UseSquarePaymentsArgs) {
  const [payments, setPayments] = React.useState<SquarePaymentsInstance | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<boolean>(enabled);

  React.useEffect(() => {
    let cancelled = false;
    if (!enabled || !applicationId || !locationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    loadSquareSdk(sdkUrl)
      .then(() => {
        if (cancelled || !window.Square) return;
        setPayments(window.Square.payments(applicationId, locationId));
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load Square");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId, locationId, sdkUrl, enabled]);

  return { payments, error, loading };
}

/** Format cents to the "12.34" string Square's verifyBuyer expects. */
export function centsToSquareAmount(cents: number): string {
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2);
}
