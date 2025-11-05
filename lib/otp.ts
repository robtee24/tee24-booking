// lib/otp.ts
import { randomInt } from "crypto";
import { ENV } from "@/lib/env";

/**
 * Simple in-memory OTP store for dev.
 * Structure: key = phone, value = { code, expiresAt }
 */
type OtpRecord = { code: string; expiresAt: number };
const store = new Map<string, OtpRecord>();

export function normalizePhone(input: string): string {
  const digits = (input || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

export function generateCode(): string {
  // 6-digit numeric, leading zeros allowed
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Create and save an OTP for a phone for `ttlSeconds` seconds.
 */
export async function createOtp(phone: string, ttlSeconds = ENV.OTP_TTL || 300) {
  const code = generateCode();
  const expiresAt = Date.now() + ttlSeconds * 1000;
  store.set(phone, { code, expiresAt });
  return { code, expiresAt };
}

/**
 * Verify an OTP. If valid, consume it (delete from store).
 */
export async function verifyOtp(phone: string, code: string) {
  const rec = store.get(phone);
  if (!rec) return { ok: false, reason: "NOT_FOUND" as const };
  if (Date.now() > rec.expiresAt) {
    store.delete(phone);
    return { ok: false, reason: "EXPIRED" as const };
  }
  if (rec.code !== code) return { ok: false, reason: "MISMATCH" as const };
  store.delete(phone);
  return { ok: true as const };
}

export function ttlRemaining(phone: string) {
  const rec = store.get(phone);
  if (!rec) return 0;
  const left = Math.max(0, rec.expiresAt - Date.now());
  return Math.ceil(left / 1000);
}
