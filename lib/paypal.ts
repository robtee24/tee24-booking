/**
 * PayPal Payouts integration — used for monthly referral payouts.
 *
 * Env:
 *   - PAYPAL_CLIENT_ID
 *   - PAYPAL_CLIENT_SECRET
 *   - PAYPAL_ENV ("live" | "sandbox") — defaults to sandbox
 */

const ENVS = {
  live: "https://api-m.paypal.com",
  sandbox: "https://api-m.sandbox.paypal.com",
} as const;

function getBase(): string {
  const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  return ENVS[env as "live" | "sandbox"] || ENVS.sandbox;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error("[paypal] missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET");

  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const res = await fetch(`${getBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[paypal] token failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

export type PayoutItem = {
  amountCents: number;
  recipientEmail: string;
  note?: string;
  senderItemId: string;
};

export type PayoutBatchResult = {
  payoutBatchId: string;
  batchStatus: string;
};

export async function paypalSendBatchPayout(input: {
  items: PayoutItem[];
  emailSubject?: string;
  batchId: string;
}): Promise<PayoutBatchResult> {
  const token = await getAccessToken();

  const res = await fetch(`${getBase()}/v1/payments/payouts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: input.batchId,
        email_subject: input.emailSubject ?? "You have a referral payout!",
      },
      items: input.items.map((it) => ({
        recipient_type: "EMAIL",
        amount: {
          value: (it.amountCents / 100).toFixed(2),
          currency: "USD",
        },
        receiver: it.recipientEmail,
        note: it.note ?? "Tee24 referral payout",
        sender_item_id: it.senderItemId,
      })),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[paypal] payout failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as any;
  return {
    payoutBatchId: data.batch_header.payout_batch_id,
    batchStatus: data.batch_header.batch_status,
  };
}

export async function paypalGetPayoutBatch(batchId: string): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`${getBase()}/v1/payments/payouts/${batchId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`[paypal] get batch failed (${res.status})`);
  return res.json();
}
