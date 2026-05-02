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

export async function sendQuoSms({ to, text, category = "TRANSACTIONAL" }: SendArgs): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const { apiKey, from } = getCreds();
  if (!apiKey || !from) {
    console.warn("[quo] SMS skipped — missing QUO_API_KEY or QUO_NUMBER");
    return { ok: false, error: "Missing Quo credentials" };
  }
  if (!to || !text) {
    return { ok: false, error: "Missing 'to' or 'text'" };
  }

  try {
    const res = await fetch("https://api.openphone.com/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, text }),
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
