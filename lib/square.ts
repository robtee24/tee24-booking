/**
 * Square integration — payments, customers, cards on file, subscriptions, refunds.
 *
 * Outbound calls go through Square REST API via `fetch` (no npm SDK). We use
 * idempotency keys derived from our domain entity IDs + attempt numbers so
 * retries are safe.
 *
 * Inbound webhooks land in `app/api/webhooks/square/route.ts`.
 *
 * Credentials are PER LOCATION: each Tee24 location can be connected to its own
 * Square business (Admin → Billing → Settings → Square). Secrets live encrypted
 * on the Location row (lib/secrets.ts). The SQUARE_* env vars remain a fallback
 * that applies to any location without its own connection:
 *  - SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, NEXT_PUBLIC_SQUARE_APPLICATION_ID
 *  - SQUARE_ENV ("production" | "sandbox"), SQUARE_WEBHOOK_SIGNATURE_KEY,
 *    SQUARE_WEBHOOK_NOTIFICATION_URL
 *
 * Every API helper takes the resolved `SquareCreds` as its first argument;
 * resolve them with `getSquareCreds(locationId)` / `requireSquare(locationId)`.
 * When a location has no credentials, callers fall back to manual (cash/other)
 * collection.
 */
import crypto from "crypto";
import { getPrisma } from "@/lib/db";
import { decryptSecret, secretHint } from "@/lib/secrets";

const ENVS = {
  production: "https://connect.squareup.com",
  sandbox: "https://connect.squareupsandbox.com",
} as const;

export type SquareEnv = keyof typeof ENVS;

export type SquareCreds = {
  /** Server-to-server access token (never sent to the browser). */
  accessToken: string;
  /** Web Payments SDK application id (browser card entry). */
  applicationId: string | null;
  /** Square's location id inside that account. */
  locationId: string;
  env: SquareEnv;
  webhookSignatureKey: string | null;
  source: "location" | "env";
};

export function normalizeSquareEnv(v: string | null | undefined): SquareEnv {
  return (v || "").toLowerCase() === "sandbox" ? "sandbox" : "production";
}

/** Env-derived credentials (legacy single-account setup). `null` when unset. */
export function envSquareCreds(): SquareCreds | null {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!accessToken || !locationId) return null;
  return {
    accessToken,
    applicationId: process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID ?? null,
    locationId,
    env: normalizeSquareEnv(process.env.SQUARE_ENV ?? "sandbox"),
    webhookSignatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? null,
    source: "env",
  };
}

const LOCATION_SQUARE_SELECT = {
  squareEnv: true,
  squareApplicationId: true,
  squareLocationId: true,
  squareAccessTokenEnc: true,
  squareWebhookSignatureKeyEnc: true,
  squareMerchantName: true,
  squareConnectedAt: true,
} as const;

type LocationSquareRow = {
  squareEnv: string | null;
  squareApplicationId: string | null;
  squareLocationId: string | null;
  squareAccessTokenEnc: string | null;
  squareWebhookSignatureKeyEnc: string | null;
  squareMerchantName?: string | null;
  squareConnectedAt?: Date | null;
};

export function credsFromLocationRow(row: LocationSquareRow | null | undefined): SquareCreds | null {
  if (!row?.squareAccessTokenEnc || !row.squareLocationId) return null;
  const accessToken = decryptSecret(row.squareAccessTokenEnc);
  if (!accessToken) return null;
  return {
    accessToken,
    applicationId: row.squareApplicationId ?? null,
    locationId: row.squareLocationId,
    env: normalizeSquareEnv(row.squareEnv),
    webhookSignatureKey: decryptSecret(row.squareWebhookSignatureKeyEnc) ?? null,
    source: "location",
  };
}

// Short-lived cache so a cron pass over hundreds of invoices doesn't re-read
// (and re-decrypt) the same Location row every time.
const CACHE_TTL_MS = 30_000;
const credsCache = new Map<string, { at: number; creds: SquareCreds | null }>();

export function invalidateSquareCreds(locationId?: string) {
  if (locationId) credsCache.delete(locationId);
  else credsCache.clear();
}

/** Credentials for a Tee24 location: its own Square connection, else the env fallback. */
export async function getSquareCreds(locationId: string): Promise<SquareCreds | null> {
  const hit = credsCache.get(locationId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.creds;
  const row = await getPrisma().location.findUnique({ where: { id: locationId }, select: LOCATION_SQUARE_SELECT });
  let creds: SquareCreds | null = null;
  try {
    creds = credsFromLocationRow(row);
  } catch (e) {
    console.error(`[square] could not decrypt credentials for location ${locationId}`, e);
  }
  if (!creds) creds = envSquareCreds();
  credsCache.set(locationId, { at: Date.now(), creds });
  return creds;
}

/** Like `getSquareCreds` but throws a user-facing error when Square isn't connected. */
export async function requireSquare(locationId: string, message = "Square is not connected for this location"): Promise<SquareCreds> {
  const creds = await getSquareCreds(locationId);
  if (!creds) throw new Error(message);
  return creds;
}

/** True when the server can charge cards on file for this location. */
export async function isSquareConfigured(locationId: string): Promise<boolean> {
  return Boolean(await getSquareCreds(locationId));
}

/** True when the browser card form can also be rendered (needs the application id). */
export function squareSupportsCardEntry(creds: SquareCreds | null): boolean {
  return Boolean(creds?.applicationId);
}

/** Browser-safe config to pass to `<CardForm />`. Never includes the access token. */
export type SquarePublicConfig = {
  configured: boolean;
  applicationId: string | null;
  locationId: string | null;
  env: SquareEnv;
  sdkUrl: string;
};

export function getSquareWebSdkUrl(env: SquareEnv): string {
  return env === "production"
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";
}

export function publicConfigFromCreds(creds: SquareCreds | null): SquarePublicConfig {
  const env = creds?.env ?? "production";
  return {
    configured: Boolean(creds && creds.applicationId),
    applicationId: creds?.applicationId ?? null,
    locationId: creds?.locationId ?? null,
    env,
    sdkUrl: getSquareWebSdkUrl(env),
  };
}

export async function getSquarePublicConfig(locationId: string): Promise<SquarePublicConfig> {
  return publicConfigFromCreds(await getSquareCreds(locationId));
}

// ---------------------------------------------------------------------------
// Admin status (never includes secrets)
// ---------------------------------------------------------------------------

export type SquareConnectionStatus = {
  configured: boolean;
  /** "location" = connected in the admin UI; "env" = SQUARE_* fallback; null = nothing. */
  source: "location" | "env" | null;
  env: SquareEnv;
  applicationId: string | null;
  squareLocationId: string | null;
  accessTokenHint: string | null;
  webhookSignatureKeySet: boolean;
  merchantName: string | null;
  connectedAt: string | null;
  /** Human-readable list of what's still missing for full functionality. */
  missing: string[];
  webhookUrl: string;
};

export async function getSquareConnectionStatus(locationId: string, appBaseUrl: string): Promise<SquareConnectionStatus> {
  const row = await getPrisma().location.findUnique({ where: { id: locationId }, select: LOCATION_SQUARE_SELECT });
  let own: SquareCreds | null = null;
  try {
    own = credsFromLocationRow(row);
  } catch {
    own = null;
  }
  const creds = own ?? envSquareCreds();
  const missing: string[] = [];
  if (!creds) missing.push("Access token", "Square location");
  else if (!creds.applicationId) missing.push("Application ID (needed for card entry in signup, portal and POS)");
  if (creds && !creds.webhookSignatureKey) missing.push("Webhook signature key (needed for refund / dispute / card-expiry sync)");
  return {
    configured: Boolean(creds),
    source: creds?.source ?? null,
    env: creds?.env ?? normalizeSquareEnv(row?.squareEnv),
    applicationId: creds?.applicationId ?? null,
    squareLocationId: creds?.locationId ?? null,
    accessTokenHint: creds ? secretHint(creds.accessToken) : null,
    webhookSignatureKeySet: Boolean(creds?.webhookSignatureKey),
    merchantName: own ? (row?.squareMerchantName ?? null) : null,
    connectedAt: own ? (row?.squareConnectedAt?.toISOString() ?? null) : null,
    missing,
    webhookUrl: `${appBaseUrl.replace(/\/$/, "")}/api/webhooks/square`,
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

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
async function squareFetch<T = any>(creds: SquareCreds, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ENVS[creds.env]}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
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

// ---------- Account / locations (connection test + picker) ----------
export type SquareLocationInfo = { id: string; name: string; businessName: string | null; status: string; currency: string | null; merchantId: string | null };

/** List the locations visible to an access token. Used to validate a token and pick the Square location. */
export async function squareListLocations(creds: Pick<SquareCreds, "accessToken" | "env">): Promise<SquareLocationInfo[]> {
  const data = await squareFetch({ ...creds, applicationId: null, locationId: "", webhookSignatureKey: null, source: "location" }, "/v2/locations");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data.locations ?? []) as any[]).map((l) => ({
    id: l.id,
    name: l.name ?? l.id,
    businessName: l.business_name ?? null,
    status: l.status ?? "ACTIVE",
    currency: l.currency ?? null,
    merchantId: l.merchant_id ?? null,
  }));
}

// ---------- Customers ----------
export async function squareCreateCustomer(creds: SquareCreds, input: {
  emailAddress: string;
  givenName: string;
  familyName: string;
  phoneNumber?: string;
  referenceId?: string;
}): Promise<{ id: string }> {
  const data = await squareFetch<{ customer: { id: string } }>(creds, "/v2/customers", {
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

export async function squareCreateCardOnFile(creds: SquareCreds, input: {
  customerId: string;
  sourceId: string; // payment token from Web Payments SDK
  idempotencyKey: string;
  verificationToken?: string | null;
  cardholderName?: string | null;
  referenceId?: string | null;
}): Promise<SquareCard> {
  const data = await squareFetch(creds, "/v2/cards", {
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

export async function squareListCards(creds: SquareCreds, customerId: string): Promise<SquareCard[]> {
  const data = await squareFetch(creds, `/v2/cards?customer_id=${encodeURIComponent(customerId)}&include_disabled=false`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data.cards ?? []) as any[]).map(mapCard);
}

export async function squareGetCard(creds: SquareCreds, cardId: string): Promise<SquareCard> {
  const data = await squareFetch(creds, `/v2/cards/${encodeURIComponent(cardId)}`);
  return mapCard(data.card);
}

export async function squareDisableCard(creds: SquareCreds, cardId: string): Promise<void> {
  await squareFetch(creds, `/v2/cards/${encodeURIComponent(cardId)}/disable`, { method: "POST" });
}

// ---------- Charges (Payments) ----------
export type SquarePaymentResult = {
  id: string;
  status: string;
  receiptUrl?: string | null;
  cardBrand?: string | null;
  last4?: string | null;
};

export async function squareCreatePayment(creds: SquareCreds, input: {
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
  const data = await squareFetch(creds, "/v2/payments", {
    method: "POST",
    body: JSON.stringify({
      source_id: input.sourceId,
      idempotency_key: input.idempotencyKey,
      amount_money: { amount: input.amountCents, currency: input.currency ?? "USD" },
      customer_id: input.customerId,
      location_id: creds.locationId,
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

export async function squareGetPayment(creds: SquareCreds, paymentId: string): Promise<SquarePaymentResult & { amountCents: number }> {
  const data = await squareFetch(creds, `/v2/payments/${encodeURIComponent(paymentId)}`);
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
export async function squareCreateRefund(creds: SquareCreds, input: {
  paymentId: string;
  amountCents: number;
  currency?: string;
  idempotencyKey: string;
  reason?: string;
}): Promise<{ id: string; status: string }> {
  const data = await squareFetch(creds, "/v2/refunds", {
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
export async function squareCreateSubscription(creds: SquareCreds, input: {
  customerId: string;
  planVariationId: string;
  cardId?: string;
  startDate?: string; // YYYY-MM-DD
  idempotencyKey: string;
}): Promise<{ id: string; status: string }> {
  const data = await squareFetch(creds, "/v2/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: input.idempotencyKey,
      location_id: creds.locationId,
      customer_id: input.customerId,
      plan_variation_id: input.planVariationId,
      start_date: input.startDate,
      card_id: input.cardId,
    }),
  });
  return { id: data.subscription.id, status: data.subscription.status };
}

export async function squareCancelSubscription(creds: SquareCreds, subscriptionId: string): Promise<void> {
  await squareFetch(creds, `/v2/subscriptions/${subscriptionId}/cancel`, { method: "POST" });
}

// ---------- Webhook verification ----------
/**
 * Verify a Square webhook signature against one signing key.
 * https://developer.squareup.com/docs/webhooks/step3validate
 */
export function verifySquareSignature(input: { body: string; signature: string; notificationUrl: string; signatureKey: string }): boolean {
  const hmac = crypto.createHmac("sha256", input.signatureKey);
  hmac.update(input.notificationUrl + input.body);
  const expected = hmac.digest("base64");
  if (expected.length !== input.signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature));
}

/**
 * With one Square account per location there is one webhook subscription (and
 * signing key) per account, all pointing at the same URL. Try every configured
 * key; return which location's account the event belongs to.
 */
export async function verifySquareWebhook(input: { body: string; signature: string; notificationUrl: string }): Promise<
  { ok: true; locationId: string | null; source: "location" | "env" } | { ok: false; reason: "no-keys" | "invalid" }
> {
  const rows = await getPrisma().location.findMany({
    where: { squareWebhookSignatureKeyEnc: { not: null } },
    select: { id: true, squareWebhookSignatureKeyEnc: true },
  });
  let anyKey = false;
  for (const row of rows) {
    let key: string | null = null;
    try {
      key = decryptSecret(row.squareWebhookSignatureKeyEnc);
    } catch {
      continue;
    }
    if (!key) continue;
    anyKey = true;
    if (verifySquareSignature({ ...input, signatureKey: key })) return { ok: true, locationId: row.id, source: "location" };
  }
  const envKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (envKey) {
    anyKey = true;
    if (verifySquareSignature({ ...input, signatureKey: envKey })) return { ok: true, locationId: null, source: "env" };
  }
  return { ok: false, reason: anyKey ? "invalid" : "no-keys" };
}
