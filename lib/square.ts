/**
 * Square integration — payments, customers, cards on file, subscriptions, refunds.
 *
 * Outbound calls go through Square REST API via `fetch` (no npm SDK). We use
 * idempotency keys derived from our domain entity IDs + attempt numbers so
 * retries are safe.
 *
 * Inbound webhooks land in `app/api/webhooks/square/route.ts`.
 *
 * Env:
 *  - SQUARE_ACCESS_TOKEN                  (server)  required
 *  - SQUARE_LOCATION_ID                   (server)  required
 *  - NEXT_PUBLIC_SQUARE_APPLICATION_ID    (client)  required — Web Payments SDK
 *  - SQUARE_ENV ("production" | "sandbox") defaults to sandbox
 *  - SQUARE_WEBHOOK_SIGNATURE_KEY         (webhook verification)
 *  - SQUARE_WEBHOOK_NOTIFICATION_URL      (webhook signature verification; defaults to request URL)
 *
 * Everything that talks to Square must be gated behind `isSquareConfigured()`.
 * When not configured, callers fall back to manual (cash/other) collection.
 */
import crypto from "crypto";

const ENVS = {
  production: "https://connect.squareup.com",
  sandbox: "https://connect.squareupsandbox.com",
} as const;

export type SquareEnv = keyof typeof ENVS;

/** Env vars the admin must set to enable Square (shown in the "Connect Square" callout). */
export const SQUARE_REQUIRED_ENV = [
  "SQUARE_ACCESS_TOKEN",
  "SQUARE_LOCATION_ID",
  "NEXT_PUBLIC_SQUARE_APPLICATION_ID",
] as const;

export const SQUARE_OPTIONAL_ENV = [
  "SQUARE_ENV",
  "SQUARE_WEBHOOK_SIGNATURE_KEY",
  "SQUARE_WEBHOOK_NOTIFICATION_URL",
] as const;

export function getSquareEnv(): SquareEnv {
  const env = (process.env.SQUARE_ENV || "sandbox").toLowerCase();
  return env === "production" ? "production" : "sandbox";
}

function getBase(): string {
  return ENVS[getSquareEnv()];
}

function getToken(): string | undefined {
  return process.env.SQUARE_ACCESS_TOKEN;
}

export function getSquareLocationId(): string | undefined {
  return process.env.SQUARE_LOCATION_ID;
}

/** True when the server + browser SDK can both be used. */
export function isSquareConfigured(): boolean {
  return Boolean(
    process.env.SQUARE_ACCESS_TOKEN &&
      process.env.SQUARE_LOCATION_ID &&
      process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID,
  );
}

/** Which required env vars are missing (for the admin callout). */
export function getSquareMissingEnv(): string[] {
  return SQUARE_REQUIRED_ENV.filter((k) => !process.env[k]);
}

/** Browser-safe config to pass to `<CardForm />`. Never includes the access token. */
export type SquarePublicConfig = {
  configured: boolean;
  applicationId: string | null;
  locationId: string | null;
  env: SquareEnv;
  sdkUrl: string;
};

export function getSquareWebSdkUrl(env: SquareEnv = getSquareEnv()): string {
  return env === "production"
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";
}

export function getSquarePublicConfig(): SquarePublicConfig {
  const env = getSquareEnv();
  return {
    configured: isSquareConfigured(),
    applicationId: process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID ?? null,
    locationId: process.env.SQUARE_LOCATION_ID ?? null,
    env,
    sdkUrl: getSquareWebSdkUrl(env),
  };
}

export class SquareApiError extends Error {
  status: number;
  code: string | null;
  detail: string | null;
  constructor(path: string, status: number, bodyText: string) {
    let code: string | null = null;
    let detail: string | null = null;
    try {
      const parsed = JSON.parse(bodyText);
      const first = parsed?.errors?.[0];
      code = first?.code ?? null;
      detail = first?.detail ?? null;
    } catch {
      /* non-JSON body */
    }
    super(`[square] ${path} failed (${status})${code ? ` ${code}` : ""}${detail ? `: ${detail}` : ""}`);
    this.name = "SquareApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** Human-readable decline reason from a Square error (used for `lastFailureReason`). */
export function squareFailureReason(err: unknown): string {
  if (err instanceof SquareApiError) return err.code ? `${err.code}${err.detail ? ` — ${err.detail}` : ""}` : err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function squareFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("[square] SQUARE_ACCESS_TOKEN missing");

  const res = await fetch(`${getBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Square-Version": "2024-12-18",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SquareApiError(path, res.status, text);
  }
  return res.json();
}

// ---------- Customers ----------
export async function squareCreateCustomer(input: {
  emailAddress: string;
  givenName: string;
  familyName: string;
  phoneNumber?: string;
  referenceId?: string;
}): Promise<{ id: string }> {
  const data = await squareFetch<{ customer: { id: string } }>("/v2/customers", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: input.referenceId ? `cust_${input.referenceId}` : crypto.randomUUID(),
      email_address: input.emailAddress,
      given_name: input.givenName,
      family_name: input.familyName,
      phone_number: input.phoneNumber,
      reference_id: input.referenceId,
    }),
  });
  return { id: data.customer.id };
}

// ---------- Cards on file ----------
export type SquareCard = { id: string; brand: string; last4: string; expMonth: number; expYear: number; enabled: boolean };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCard(c: any): SquareCard {
  return {
    id: c.id,
    brand: c.card_brand ?? "CARD",
    last4: c.last_4 ?? "",
    expMonth: Number(c.exp_month ?? 0),
    expYear: Number(c.exp_year ?? 0),
    enabled: c.enabled !== false,
  };
}

export async function squareCreateCardOnFile(input: {
  customerId: string;
  sourceId: string; // payment token from Web Payments SDK
  idempotencyKey: string;
  verificationToken?: string | null;
  cardholderName?: string | null;
  referenceId?: string | null;
}): Promise<SquareCard> {
  const data = await squareFetch("/v2/cards", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: input.idempotencyKey,
      source_id: input.sourceId,
      verification_token: input.verificationToken ?? undefined,
      card: {
        customer_id: input.customerId,
        cardholder_name: input.cardholderName ?? undefined,
        reference_id: input.referenceId ?? undefined,
      },
    }),
  });
  return mapCard(data.card);
}

export async function squareListCards(customerId: string): Promise<SquareCard[]> {
  const data = await squareFetch(`/v2/cards?customer_id=${encodeURIComponent(customerId)}&include_disabled=false`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data.cards ?? []) as any[]).map(mapCard);
}

export async function squareGetCard(cardId: string): Promise<SquareCard> {
  const data = await squareFetch(`/v2/cards/${encodeURIComponent(cardId)}`);
  return mapCard(data.card);
}

export async function squareDisableCard(cardId: string): Promise<void> {
  await squareFetch(`/v2/cards/${encodeURIComponent(cardId)}/disable`, { method: "POST" });
}

// ---------- Charges (Payments) ----------
export type SquarePaymentResult = {
  id: string;
  status: string;
  receiptUrl?: string | null;
  cardBrand?: string | null;
  last4?: string | null;
};

export async function squareCreatePayment(input: {
  amountCents: number;
  currency?: string;
  sourceId: string; // card_id or web payment token
  customerId?: string;
  idempotencyKey: string;
  note?: string;
  referenceId?: string;
  verificationToken?: string | null;
  buyerEmailAddress?: string | null;
}): Promise<SquarePaymentResult> {
  const data = await squareFetch("/v2/payments", {
    method: "POST",
    body: JSON.stringify({
      source_id: input.sourceId,
      idempotency_key: input.idempotencyKey,
      amount_money: { amount: input.amountCents, currency: input.currency ?? "USD" },
      customer_id: input.customerId,
      location_id: getSquareLocationId(),
      note: input.note,
      reference_id: input.referenceId,
      verification_token: input.verificationToken ?? undefined,
      buyer_email_address: input.buyerEmailAddress ?? undefined,
      autocomplete: true,
    }),
  });
  const p = data.payment;
  return {
    id: p.id,
    status: p.status,
    receiptUrl: p.receipt_url ?? null,
    cardBrand: p.card_details?.card?.card_brand ?? null,
    last4: p.card_details?.card?.last_4 ?? null,
  };
}

export async function squareGetPayment(paymentId: string): Promise<SquarePaymentResult & { amountCents: number }> {
  const data = await squareFetch(`/v2/payments/${encodeURIComponent(paymentId)}`);
  const p = data.payment;
  return {
    id: p.id,
    status: p.status,
    receiptUrl: p.receipt_url ?? null,
    cardBrand: p.card_details?.card?.card_brand ?? null,
    last4: p.card_details?.card?.last_4 ?? null,
    amountCents: Number(p.amount_money?.amount ?? 0),
  };
}

// ---------- Refunds ----------
export async function squareCreateRefund(input: {
  paymentId: string;
  amountCents: number;
  currency?: string;
  idempotencyKey: string;
  reason?: string;
}): Promise<{ id: string; status: string }> {
  const data = await squareFetch("/v2/refunds", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: input.idempotencyKey,
      payment_id: input.paymentId,
      amount_money: { amount: input.amountCents, currency: input.currency ?? "USD" },
      reason: input.reason,
    }),
  });
  return { id: data.refund.id, status: data.refund.status };
}

// ---------- Subscriptions ----------
export async function squareCreateSubscription(input: {
  customerId: string;
  planVariationId: string;
  cardId?: string;
  startDate?: string; // YYYY-MM-DD
  idempotencyKey: string;
}): Promise<{ id: string; status: string }> {
  const data = await squareFetch("/v2/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: input.idempotencyKey,
      location_id: process.env.SQUARE_LOCATION_ID,
      customer_id: input.customerId,
      plan_variation_id: input.planVariationId,
      start_date: input.startDate,
      card_id: input.cardId,
    }),
  });
  return { id: data.subscription.id, status: data.subscription.status };
}

export async function squareCancelSubscription(subscriptionId: string): Promise<void> {
  await squareFetch(`/v2/subscriptions/${subscriptionId}/cancel`, { method: "POST" });
}

// ---------- Webhook verification ----------
/**
 * Verify Square webhook signature.
 * https://developer.squareup.com/docs/webhooks/step3validate
 */
export function verifySquareSignature(input: {
  body: string;
  signature: string;
  notificationUrl: string;
  signatureKey?: string;
}): boolean {
  const key = input.signatureKey ?? process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key) {
    console.warn("[square] SQUARE_WEBHOOK_SIGNATURE_KEY missing — accepting webhook unverified");
    return true;
  }
  const hmac = crypto.createHmac("sha256", key);
  hmac.update(input.notificationUrl + input.body);
  const expected = hmac.digest("base64");
  if (expected.length !== input.signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature));
}
