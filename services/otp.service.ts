// services/otp.service.ts

import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { ENV } from "@/lib/env";
import { resolveJwtSecret } from "@/lib/jwt-secret";
import { getPrisma } from "@/lib/db";
import { sendSms } from "@/lib/openphone";
import { toE164 } from "@/lib/phone";
import type { OtpPurpose, VerifyOtpResult } from "@/types/otp";

const DEFAULT_TTL = ENV.OTP_TTL ?? 300;
/**
 * Wrong guesses allowed per code before it is burned. A 6-digit code with a
 * 5-minute TTL is trivially brute-forceable without this; 5 tries keeps the
 * success odds for an attacker at 0.0005% per code while leaving room for a
 * fat-fingered legitimate user.
 */
const MAX_ATTEMPTS = 5;

function codesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Codes are stored as a keyed hash so a database read (backup, leaked
 * connection string, SQL injection elsewhere) doesn't hand out live login codes.
 * The pepper comes from env; in production a configured secret is required.
 */
let pepperCache: Buffer | null = null;
function pepper(): Buffer {
  if (!pepperCache) pepperCache = Buffer.from(resolveJwtSecret(["OTP_PEPPER", "ADMIN_JWT_SECRET", "AUTH_SECRET"], "dev-otp-pepper"));
  return pepperCache;
}
function hashCode(phone: string, code: string): string {
  return createHmac("sha256", pepper()).update(`${phone}:${code}`).digest("hex");
}

/**
 * Single source of truth for all OTP flows in the app
 */
export class OtpService {
  /* -------------------------------------------------------------------------- */
  /*                               Private Helpers                              */
  /* -------------------------------------------------------------------------- */

  private generateCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, "0");
  }

  private buildMessage(code: string, purpose: OtpPurpose, ttlSeconds: number): string {
    const minutes = Math.floor(ttlSeconds / 60);

    const templates: Record<OtpPurpose, string> = {
      admin_login: `Your Tee24 admin login code is ${code}. Expires in ${minutes} min.`,
      customer_booking: `Tee24 booking verification code: ${code}. Expires in ${minutes} min.`,
      customer_signup: `Welcome to Tee24! Your code is ${code}. Expires in ${minutes} min.`,
      mobile_login: `Your Tee24 app sign-in code is ${code}. Expires in ${minutes} min. Never share this code.`,
      password_reset: `Your Tee24 password reset code is ${code}. Expires in ${minutes} min.`,
    };

    return templates[purpose] ?? `Your verification code is ${code}. Expires in ${minutes} min.`;
  }

  /* -------------------------------------------------------------------------- */
  /*                                 Public API                                 */
  /* -------------------------------------------------------------------------- */

  /**
   * Public accessor — used by other services (AdminAuthService, future BookingService, etc.)
   */
  public normalize(rawPhone: string): string {
    return toE164(rawPhone);
  }

  /**
   * Request + send a fresh OTP
   */
  async requestOtp(
    rawPhone: string,
    purpose: OtpPurpose,
    ttlSeconds?: number
  ): Promise<{ ok: true; expiresAt: number }> {
    const phone = toE164(rawPhone); // throws if invalid

    const ttl = ttlSeconds ?? DEFAULT_TTL;
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + ttl * 1000);

    const stored = hashCode(phone, code);
    await getPrisma().otp.upsert({
      where: { phone },
      update: { code: stored, expiresAt, attempts: 0 },
      create: { phone, code: stored, expiresAt },
    });

    const message = this.buildMessage(code, purpose, ttl);

    await sendSms({
      from: ENV.OPENPHONE_NUMBER!,
      to: [phone],
      content: message,
      // One-time codes must never be stored in the message log.
      ledger: false,
      ...(ENV.OPENPHONE_USER_ID ? { userId: ENV.OPENPHONE_USER_ID } : {}),
    });

    return { ok: true, expiresAt: expiresAt.getTime() };
  }

  /**
   * Verify a submitted OTP code
   */
  async verifyOtp(rawPhone: string, code: string | number): Promise<VerifyOtpResult> {
    const phone = toE164(rawPhone);
    const codeStr = String(code).trim();

    if (!/^\d{6}$/.test(codeStr)) {
      return { ok: false, reason: "INVALID_FORMAT" };
    }

    const record = await getPrisma().otp.findUnique({
      where: { phone },
    });

    if (!record) return { ok: false, reason: "NOT_FOUND" };
    if (new Date() > record.expiresAt) {
      await getPrisma().otp.delete({ where: { phone } }).catch(() => undefined);
      return { ok: false, reason: "EXPIRED" };
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      await getPrisma().otp.delete({ where: { phone } }).catch(() => undefined);
      return { ok: false, reason: "TOO_MANY_ATTEMPTS" };
    }
    // Rows written before hashing was introduced hold the 6-digit code itself;
    // they expire within minutes, so accept either form during the transition.
    const expected = /^\d{6}$/.test(record.code) ? codeStr : hashCode(phone, codeStr);
    if (!codesMatch(record.code, expected)) {
      // Count the miss first so parallel guesses can't all slip under the cap.
      const updated = await getPrisma().otp.update({
        where: { phone },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      if (updated.attempts >= MAX_ATTEMPTS) {
        await getPrisma().otp.delete({ where: { phone } }).catch(() => undefined);
        return { ok: false, reason: "TOO_MANY_ATTEMPTS" };
      }
      return { ok: false, reason: "MISMATCH" };
    }

    // One-time use → delete. `deleteMany` returns a count instead of throwing,
    // so two concurrent correct submissions can't both succeed.
    const consumed = await getPrisma().otp.deleteMany({ where: { phone, code: record.code } });
    if (consumed.count === 0) return { ok: false, reason: "NOT_FOUND" };
    return { ok: true };
  }

  /**
   * Resend = just generate a new one (overwrites old)
   */
  async resendOtp(rawPhone: string, purpose: OtpPurpose, ttlSeconds?: number) {
    return this.requestOtp(rawPhone, purpose, ttlSeconds);
  }
}

/* -------------------------------------------------------------------------- */
/*                            Singleton for API routes                        */
/* -------------------------------------------------------------------------- */

export const otpService = new OtpService();