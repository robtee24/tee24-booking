/**
 * Square integration — payments, customers, subscriptions, refunds.
 *
 * Outbound calls go through Square REST API. We use idempotency keys derived
 * from our domain entity IDs + attempt numbers so retries are safe.
 *
 * Inbound webhooks land in `app/api/webhooks/square/route.ts`.
 *
 * Env:
 *  - SQUARE_ACCESS_TOKEN
 *  - SQUARE_LOCATION_ID
 *  - SQUARE_ENV ("production" | "sandbox") - defaults to sandbox
 *  - SQUARE_WEBHOOK_SIGNATURE_KEY (for webhook verification)
 *  - SQUARE_WEBHOOK_NOTIFICATION_URL (for webhook signature verification)
 */
import crypto from "crypto";

const ENVS = {
  production: "https://connect.squareup.com",
  sandbox: "https://connect.squareupsandbox.com",
} as const;

function getBase(): string {
  const env = (process.env.SQUARE_ENV || "sandbox").toLowerCase();
  return ENVS[env as "production" | "sandbox"] || ENVS.sandbox;
}

function getToken(): string | undefined {
  return process.env.SQUARE_ACCESS_TOKEN;
}

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
    throw new Error(`[square] ${path} failed (${res.status}): ${text}`);
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
export async function squareCreateCardOnFile(input: {
  customerId: string;
  sourceId: string; // payment token from Web Payments SDK
  idempotencyKey: string;
}): Promise<{ id: string; brand: string; last4: string; expMonth: number; expYear: number }> {
  const data = await squareFetch<any>("/v2/cards", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: input.idempotencyKey,
      source_id: input.sourceId,
      card: { customer_id: input.customerId },
    }),
  });
  return {
    id: data.card.id,
    brand: data.card.card_brand,
    last4: data.card.last_4,
    expMonth: data.card.exp_month,
    expYear: data.card.exp_year,
  };
}

// ---------- Charges (Payments) ----------
export async function squareCreatePayment(input: {
  amountCents: number;
  currency?: string;
  sourceId: string; // card_id or web payment token
  customerId?: string;
  idempotencyKey: string;
  note?: string;
}): Promise<{ id: string; status: string }> {
  const data = await squareFetch<any>("/v2/payments", {
    method: "POST",
    body: JSON.stringify({
      source_id: input.sourceId,
      idempotency_key: input.idempotencyKey,
      amount_money: { amount: input.amountCents, currency: input.currency ?? "USD" },
      customer_id: input.customerId,
      note: input.note,
      autocomplete: true,
    }),
  });
  return { id: data.payment.id, status: data.payment.status };
}

// ---------- Refunds ----------
export async function squareCreateRefund(input: {
  paymentId: string;
  amountCents: number;
  currency?: string;
  idempotencyKey: string;
  reason?: string;
}): Promise<{ id: string; status: string }> {
  const data = await squareFetch<any>("/v2/refunds", {
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
  const data = await squareFetch<any>("/v2/subscriptions", {
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
  return expected === input.signature;
}
