// lib/openphone.ts
import { ENV } from "@/lib/env";

/**
 * Quo (OpenPhone) API helpers.
 *
 * Auth: raw API key in the `Authorization` header — no "Bearer" prefix.
 *
 * Key API constraint: POST /v1/messages only accepts maxItems: 1 in `to`.
 * sendSms() loops and fires one request per recipient.
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
  return /^\+[1-9]\d{1,14}$/.test(n);
}

/** Also accept phoneNumberId format (PN...) as a valid `from` value */
function isValidFrom(n: string) {
  return isE164(n) || /^PN/.test(n);
}

type OpenPhoneInit = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

async function openphoneFetch(path: string, init: OpenPhoneInit = {}) {
  const key = assertEnv();

  const headers: Record<string, string> = {
    Authorization: key,  // raw key — no "Bearer" prefix per Quo API spec
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
  };

  const res = await fetch(`https://api.openphone.com${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `OpenPhone ${init.method ?? "GET"} ${path} failed: ${res.status} ${text} (key:${maskKey(key)})`
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
  from: string;     // E.164 ("+15024102382") or phoneNumberId ("PN...")
  to: string[];     // One or more E.164 recipient numbers
  content: string;  // Message body (max 1600 chars)
  userId?: string;  // Optional Quo user ID ("US...") — defaults to phone number owner
};

/**
 * Send an SMS via Quo (OpenPhone).
 *
 * The API only accepts one recipient per request (maxItems: 1 on `to`).
 * This function fires one request per number and settles all in parallel.
 * If any individual send fails the error is rethrown after all settle.
 */
export async function sendSms({ from, to, content, userId }: SendSmsArgs): Promise<void> {
  if (!from || !isValidFrom(from)) {
    throw new Error(`Invalid 'from' value (must be E.164 or phoneNumberId), got: ${from}`);
  }
  if (!Array.isArray(to) || to.length === 0) {
    throw new Error(`'to' must be a non-empty array, got: ${JSON.stringify(to)}`);
  }
  if (!to.every(isE164)) {
    throw new Error(`All 'to' numbers must be E.164 format, got: ${JSON.stringify(to)}`);
  }
  if (!content || !content.trim()) {
    throw new Error("SMS 'content' must be a non-empty string");
  }

  // Quo API: to maxItems = 1 — send one request per recipient
  const results = await Promise.allSettled(
    to.map((recipient) => {
      const body: Record<string, unknown> = { from, to: [recipient], content };
      if (userId) body.userId = userId;
      return openphoneFetch("/v1/messages", {
        method: "POST",
        body: JSON.stringify(body),
      });
    })
  );

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length > 0) {
    throw new Error(failures.map((f) => f.reason?.message ?? String(f.reason)).join("; "));
  }
}

