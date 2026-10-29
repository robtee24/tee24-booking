// lib/expo-push.ts
//
// Thin client for the Expo Push API. Tokens come from the members app
// (expo-notifications → `ExponentPushToken[...]`) and are stored on
// MemberDevice.pushToken. Delivery policy lives in lib/notify.ts; this module
// only talks HTTP.
//
//   • Batches of ≤100 messages per request (Expo's limit)
//   • Optional EXPO_ACCESS_TOKEN for enhanced security
//   • COMMS_DRY_RUN / PUSH_DRY_RUN log instead of sending

const PUSH_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const CHUNK = 100;

export type ExpoPushMessage = {
  to: string;
  title?: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  priority?: "default" | "normal" | "high";
  ttl?: number;
};

export type ExpoPushTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: ExpoPushErrorCode; [k: string]: unknown } };

export type ExpoPushReceipt =
  | { status: "ok" }
  | { status: "error"; message: string; details?: { error?: ExpoPushErrorCode; [k: string]: unknown } };

export type ExpoPushErrorCode =
  | "DeviceNotRegistered"
  | "InvalidCredentials"
  | "MessageTooBig"
  | "MessageRateExceeded"
  | "MismatchSenderId"
  | "DeveloperError"
  | "ExpoError"
  | "ProviderError";

export function isExpoPushToken(token: string | null | undefined): token is string {
  if (!token) return false;
  return /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(token.trim());
}

export function isPushDryRun(): boolean {
  const v = (k: string) => process.env[k] === "1" || process.env[k] === "true";
  return v("PUSH_DRY_RUN") || v("COMMS_DRY_RUN");
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  const token = process.env.EXPO_ACCESS_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * Send a batch of push messages. Returns one ticket per message, in order.
 * Transport failures are surfaced as error tickets so callers never throw.
 */
export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];
  if (isPushDryRun()) {
    for (const m of messages) console.log("[expo-push] DRY_RUN", { to: m.to, title: m.title, preview: m.body.slice(0, 80) });
    return messages.map(() => ({ status: "ok" as const, id: `dry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }));
  }

  const out: ExpoPushTicket[] = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    try {
      const res = await fetch(PUSH_URL, { method: "POST", headers: headers(), body: JSON.stringify(chunk) });
      const json = (await res.json().catch(() => null)) as { data?: ExpoPushTicket[]; errors?: Array<{ code?: string; message?: string }> } | null;
      if (!res.ok || !json?.data || !Array.isArray(json.data)) {
        const msg = json?.errors?.[0]?.message || `Expo push HTTP ${res.status}`;
        out.push(...chunk.map(() => ({ status: "error" as const, message: msg })));
        continue;
      }
      out.push(...json.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      out.push(...chunk.map(() => ({ status: "error" as const, message: msg })));
    }
  }
  return out;
}

/** Fetch delivery receipts for ticket ids (Expo keeps them ~24h). */
export async function getExpoReceipts(ids: string[]): Promise<Record<string, ExpoPushReceipt>> {
  const result: Record<string, ExpoPushReceipt> = {};
  const real = ids.filter((id) => id && !id.startsWith("dry_"));
  for (let i = 0; i < real.length; i += 1000) {
    const chunk = real.slice(i, i + 1000);
    try {
      const res = await fetch(RECEIPTS_URL, { method: "POST", headers: headers(), body: JSON.stringify({ ids: chunk }) });
      const json = (await res.json().catch(() => null)) as { data?: Record<string, ExpoPushReceipt> } | null;
      if (json?.data) Object.assign(result, json.data);
    } catch (err) {
      console.warn("[expo-push] receipts fetch failed", err);
    }
  }
  return result;
}

/** Push payload size guard — Expo rejects > 4 KiB. */
export function clampPushBody(body: string, max = 1_000): string {
  const t = body.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
