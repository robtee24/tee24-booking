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

type SendArgs = {
  to: string;
  text: string;
  // Category drives compliance gate enforcement upstream — included here for logging.
  category?: "TRANSACTIONAL" | "MARKETING" | "SYSTEM";
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

export async function sendQuoSms({ to, text, category = "TRANSACTIONAL" }: SendArgs): Promise<{ ok: boolean; providerId?: string; error?: string; dryRun?: boolean }> {
  if (!to || !text) {
    return { ok: false, error: "Missing 'to' or 'text'" };
  }
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
  } catch (err: any) {
    console.error("[quo] send error:", err);
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * Verify a Quo webhook signature (HMAC).
 * Quo signs requests with X-Quo-Signature header.
 */
export function verifyQuoSignature(_signature: string, _body: string): boolean {
  // TODO: implement HMAC verification when QUO_WEBHOOK_SECRET is provisioned.
  // For now we accept all webhooks if a webhook secret env var is missing,
  // and the receiver should still validate the payload shape.
  return true;
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
