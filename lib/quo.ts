/**
 * Quo (formerly OpenPhone) SMS integration.
 *
 * Quo API is API-compatible with OpenPhone — same endpoint, same auth.
 * We keep both env var names as aliases so existing deploys don't break.
 *
 * Outbound: send SMS, send templated.
 * Inbound: handled by `app/api/webhooks/quo/route.ts` (TBD).
 *
 * TCPA compliance: callers MUST verify the recipient has SMS opt-in
 * (Member.optInSmsMarketing) for marketing sends. Transactional sends
 * (booking confirmations, password resets) bypass that gate.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { recordOutbound, type LedgerOption } from "@/lib/message-ledger";

type SendArgs = {
  to: string;
  text: string;
  // Category drives compliance gate enforcement upstream — included here for logging.
  category?: "TRANSACTIONAL" | "MARKETING" | "SYSTEM";
  /** Message-ledger hint; `false` when the caller logs its own Message row. */
  ledger?: LedgerOption;
};

function getCreds() {
  const apiKey =
    process.env.QUO_API_KEY ||
    process.env.OPENPHONE_API_KEY ||
    process.env.OPENPHONE_TOKEN;
  const from = process.env.QUO_NUMBER || process.env.OPENPHONE_NUMBER || process.env.OPENPHONE_FROM;
  return { apiKey, from };
}

/** The number we send from (for display in settings). */
export function getQuoFromNumber(): string | null {
  return getCreds().from ?? null;
}

/**
 * DRY RUN: when COMMS_DRY_RUN=1 (or SMS_DRY_RUN=1) we log instead of hitting
 * Quo. Used for local smoke tests so no real customer is ever texted.
 */
export function isSmsDryRun(): boolean {
  const v = process.env.SMS_DRY_RUN ?? process.env.COMMS_DRY_RUN;
  return v === "1" || v === "true";
}

/** GSM-7 vs UCS-2 aware segment counter (160/153 or 70/67). */
export function smsSegmentInfo(text: string): { chars: number; segments: number; perSegment: number; encoding: "GSM-7" | "UCS-2" } {
  const gsm7 = /^[\x20-\x7E\n\r€£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉÄÖÑÜ§¿äöñüà]*$/u.test(text);
  const chars = Array.from(text).length;
  if (gsm7) {
    const per = chars <= 160 ? 160 : 153;
    return { chars, segments: chars === 0 ? 0 : Math.ceil(chars / per), perSegment: 153, encoding: "GSM-7" };
  }
  const per = chars <= 70 ? 70 : 67;
  return { chars, segments: chars === 0 ? 0 : Math.ceil(chars / per), perSegment: 67, encoding: "UCS-2" };
}

type SendResult = { ok: boolean; providerId?: string; error?: string; dryRun?: boolean };

export async function sendQuoSms({ to, text, category = "TRANSACTIONAL", ledger }: SendArgs): Promise<SendResult> {
  if (!to || !text) {
    return { ok: false, error: "Missing 'to' or 'text'" };
  }
  const result = await sendQuoSmsInner({ to, text, category });
  if (ledger !== false) {
    await recordOutbound({
      channel: "SMS",
      to,
      body: text,
      ok: result.ok,
      providerId: result.providerId ?? null,
      error: result.error ?? null,
      dryRun: result.dryRun,
      hint: { category, ...(ledger ?? {}) },
    });
  }
  return result;
}

async function sendQuoSmsInner({ to, text, category = "TRANSACTIONAL" }: Omit<SendArgs, "ledger">): Promise<SendResult> {
  if (isSmsDryRun()) {
    console.log("[quo] DRY_RUN sms", { to, category, chars: text.length, preview: text.slice(0, 80) });
    return { ok: true, providerId: `dry_${Date.now()}`, dryRun: true };
  }
  const { apiKey, from } = getCreds();
  if (!apiKey || !from) {
    console.warn("[quo] SMS skipped — missing QUO_API_KEY or QUO_NUMBER");
    return { ok: false, error: "Missing Quo credentials" };
  }

  try {
    const res = await fetch("https://api.openphone.com/v1/messages", {
      method: "POST",
      headers: {
        Authorization: apiKey,          // raw key — no "Bearer" prefix
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],         // must be an array
        content: text,    // field is "content", not "text"
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[quo] send failed:", res.status, errText, { category });
      return { ok: false, error: `${res.status}: ${errText}` };
    }
    const data = (await res.json().catch(() => null)) as any;
    return { ok: true, providerId: data?.data?.id ?? data?.id };
  } catch (err) {
    console.error("[quo] send error:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Verify a Quo webhook signature (HMAC).
 * Quo signs requests with X-Quo-Signature header.
 */
export function verifyQuoSignature(
  signature: string | null | undefined,
  body: string,
  standard?: { id?: string | null; timestamp?: string | null; signature?: string | null },
): boolean {
  const secret = process.env.QUO_WEBHOOK_SECRET || process.env.OPENPHONE_WEBHOOK_SECRET;
  // Without a provisioned secret we accept the webhook; the receiver still validates payload shape.
  if (!secret) return true;
  try {
    // Both generations base64-decode the secret into raw key bytes. The current
    // generation prefixes it with `whsec_`; legacy secrets are bare base64.
    const bare = secret.replace(/^whsec_/, "");
    const key = /^[A-Za-z0-9+/=]+$/.test(bare) && bare.length % 4 === 0 ? Buffer.from(bare, "base64") : Buffer.from(secret, "utf8");

    // Current generation (Standard Webhooks): webhook-id / webhook-timestamp /
    // webhook-signature ("v1,<b64> v1,<b64>"), signed `${id}.${ts}.${body}`, ts in seconds.
    if (standard?.id && standard.timestamp && standard.signature) {
      const ts = Number(standard.timestamp);
      if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
      const expected = createHmac("sha256", key).update(`${standard.id}.${standard.timestamp}.${body}`).digest("base64");
      return standard.signature
        .split(" ")
        .map((s) => s.trim())
        .filter(Boolean)
        .some((entry) => safeEqual(expected, entry.replace(/^v1,/, "")));
    }

    if (!signature) return false;
    // Legacy generation: "hmac;<version>;<timestamp ms>;<base64>" over `${timestamp}.${body}`.
    const parts = signature.split(";");
    if (parts.length === 4 && parts[0] === "hmac") {
      const expected = createHmac("sha256", key).update(`${parts[2]}.${body}`).digest("base64");
      return safeEqual(expected, parts[3]);
    }
    // Also accept a bare hex/base64 HMAC-SHA256 of the raw body.
    const hex = createHmac("sha256", key).update(body).digest("hex");
    const b64 = createHmac("sha256", key).update(body).digest("base64");
    return safeEqual(hex, signature) || safeEqual(b64, signature);
  } catch {
    return false;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Detect TCPA opt-out keywords (STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT).
 * Quo handles platform-level opt-out automatically; this is for our own logs
 * and to update Member.optInSmsMarketing.
 */
export function isOptOutMessage(body: string): boolean {
  const norm = body.trim().toLowerCase();
  return [
    "stop",
    "stopall",
    "unsubscribe",
    "cancel",
    "end",
    "quit",
    "no",
    "remove",
  ].some((kw) => norm === kw);
}

export function isOptInMessage(body: string): boolean {
  const norm = body.trim().toLowerCase();
  return ["start", "yes", "subscribe", "unstop"].includes(norm);
}
