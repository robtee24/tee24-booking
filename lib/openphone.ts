// lib/openphone.ts
import { ENV } from "@/lib/env";

/**
 * OpenPhone API helpers
 * - Some OpenPhone environments expect the key in `Authorization` (raw key, not Bearer)
 * - Others accept `X-API-Key`
 * We send BOTH to be safe.
 */

function assertEnv() {
  if (!ENV.OPENPHONE_API_KEY?.trim()) {
    throw new Error("OPENPHONE_API_KEY is missing");
  }
  return ENV.OPENPHONE_API_KEY.trim();
}

function maskKey(k: string) {
  if (!k) return "";
  if (k.length <= 6) return "***";
  return `${k.slice(0, 3)}***${k.slice(-3)}`;
}

function isE164(n: string) {
  return /^\+\d{7,15}$/.test(n);
}

type OpenPhoneInit = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

async function openphoneFetch(path: string, init: OpenPhoneInit = {}) {
  const key = assertEnv();

  const headers: Record<string, string> = {
    // Per docs / observed behavior: accept either/both
    Authorization: key,            // RAW key (not "Bearer ...")
    "X-API-Key": key,              // Some setups require this instead
    "Content-Type": "application/json",
    "User-Agent": "tee24-booking/1.0",
    ...(init.headers ?? {}),
  };

  const res = await fetch(`https://api.openphone.com${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    // Include masked key in error to confirm which value was used
    throw new Error(
      `OpenPhone ${init.method ?? "GET"} ${path} failed: ${res.status} ${text} (key:${maskKey(
        key
      )})`
    );
  }
  return res;
}

/** Public helper to quickly verify the key + workspace numbers */
export async function listPhoneNumbers(): Promise<any> {
  const res = await openphoneFetch("/v1/phone-numbers", { method: "GET" });
  return res.json();
}

type SendSmsArgs = {
  from: string;     // E.164 number in your workspace, e.g. "+15024102382"
  to: string[];     // Array of E.164 numbers, e.g. ["+13364205540"]
  content: string;  // Message body
};

/** Send an SMS via OpenPhone */
export async function sendSms({ from, to, content }: SendSmsArgs): Promise<void> {
  if (!from || !isE164(from)) {
    throw new Error(`Invalid 'from' number (must be E.164), got: ${from}`);
  }
  if (!Array.isArray(to) || to.length === 0 || !to.every(isE164)) {
    throw new Error(`Invalid 'to' numbers (must be E.164 array), got: ${JSON.stringify(to)}`);
  }
  if (!content || !content.trim()) {
    throw new Error("SMS 'content' must be a non-empty string");
  }

  await openphoneFetch("/v1/messages", {
    method: "POST",
    body: JSON.stringify({ from, to, content }),
  });
}

