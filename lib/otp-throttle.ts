/**
 * Cheap abuse guard for public one-time-code senders (signup / portal login).
 *
 * - Per phone: at most one SMS every 30s, derived from the stored Otp row so it
 *   holds across serverless instances.
 * - Per IP: a best-effort in-memory window (resets on cold start).
 */
import { ENV } from "@/lib/env";
import { getPrisma } from "@/lib/db";
import { toE164 } from "@/lib/phone";

const PER_PHONE_SECONDS = 30;
const PER_IP_MAX = 10;
const PER_IP_WINDOW_MS = 10 * 60 * 1000;
const ipHits = new Map<string, number[]>();

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

export async function otpSendAllowed(rawPhone: string, ip: string): Promise<{ ok: true } | { ok: false; retryInSeconds: number }> {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < PER_IP_WINDOW_MS);
  if (hits.length >= PER_IP_MAX) return { ok: false, retryInSeconds: Math.ceil((PER_IP_WINDOW_MS - (now - hits[0]!)) / 1000) };

  const phone = toE164(rawPhone);
  const existing = await getPrisma().otp.findUnique({ where: { phone }, select: { expiresAt: true } });
  if (existing) {
    const ttlMs = (ENV.OTP_TTL ?? 300) * 1000;
    const sentAt = existing.expiresAt.getTime() - ttlMs;
    const age = now - sentAt;
    if (age >= 0 && age < PER_PHONE_SECONDS * 1000) return { ok: false, retryInSeconds: Math.ceil((PER_PHONE_SECONDS * 1000 - age) / 1000) };
  }

  hits.push(now);
  ipHits.set(ip, hits);
  return { ok: true };
}
