// services/otp.service.ts

import { randomInt } from "crypto";
import { ENV } from "@/lib/env";
import { getPrisma } from "@/lib/db";
import { sendSms } from "@/lib/openphone";

import type { OtpPurpose, VerifyOtpResult } from "@/types/otp";

const DEFAULT_TTL = ENV.OTP_TTL ?? 300;

/**
 * Single source of truth for all OTP flows in the app
 * (admin login, customer booking verification, signup, password reset, etc.)
 */
export class OtpService {
  /* -------------------------------------------------------------------------- */
  /*                               Private Helpers                              */
  /* -------------------------------------------------------------------------- */

  private normalizePhone(input: string): string {
    const digits = (input ?? "").replace(/\D/g, "");
    if (!digits) return "";
    return digits.length === 10 ? `+1${digits}` : `+${digits}`;
  }

  private generateCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, "0");
  }

  private buildMessage(code: string, purpose: OtpPurpose, ttlSeconds: number): string {
    const minutes = Math.floor(ttlSeconds / 60);

    const templates: Record<OtpPurpose, string> = {
      admin_login: `Your Tee24 admin login code is ${code}. Expires in ${minutes} min.`,
      customer_booking: `Tee24 booking verification code: ${code}. Expires in ${minutes} min.`,
      customer_signup: `Welcome to Tee24! Your code is ${code}. Expires in ${minutes} min.`,
      password_reset: `Your Tee24 password reset code is ${code}. Expires in ${minutes} min.`,
    };

    return templates[purpose] ?? `Your verification code is ${code}. Expires in ${minutes} min.`;
  }

  /* -------------------------------------------------------------------------- */
  /*                                 Public API                                 */
  /* -------------------------------------------------------------------------- */

  /**
   * Public safe way to normalize a phone number — used by other services
   */
  public normalize(rawPhone: string): string {
    return this.normalizePhone(rawPhone);
  }

  /**
   * Request and send a fresh OTP
   */
  async requestOtp(
    rawPhone: string,
    purpose: OtpPurpose,
    ttlSeconds?: number
  ): Promise<{ ok: true; expiresAt: number }> {
    const phone = this.normalizePhone(rawPhone);
    if (!phone) throw new Error("Invalid phone number");

    const ttl = ttlSeconds ?? DEFAULT_TTL;
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + ttl * 1000);

    await getPrisma().otp.upsert({
      where: { phone },
      update: { code, expiresAt },
      create: { phone, code, expiresAt },
    });

    const message = this.buildMessage(code, purpose, ttl);

    await sendSms({
      from: ENV.OPENPHONE_NUMBER!,
      to: [phone],
      content: message,
    });

    return { ok: true, expiresAt: expiresAt.getTime() };
  }

  /**
   * Verify a submitted OTP code
   */
  async verifyOtp(rawPhone: string, code: string | number): Promise<VerifyOtpResult> {
    const phone = this.normalizePhone(rawPhone);
    const codeStr = String(code).trim();

    if (!phone || !/^\d{6}$/.test(codeStr)) {
      return { ok: false, reason: "INVALID_FORMAT" };
    }

    const record = await getPrisma().otp.findUnique({
      where: { phone },
    });

    if (!record) return { ok: false, reason: "NOT_FOUND" };

    if (new Date() > record.expiresAt) {
      await getPrisma().otp.delete({ where: { phone } });
      return { ok: false, reason: "EXPIRED" };
    }

    if (record.code !== codeStr) {
      return { ok: false, reason: "MISMATCH" };
    }

    // One-time use → delete record
    await getPrisma().otp.delete({ where: { phone } });

    return { ok: true };
  }

  /**
   * Convenience method — resend just generates a new OTP (overwrites old one)
   */
  async resendOtp(rawPhone: string, purpose: OtpPurpose, ttlSeconds?: number) {
    return this.requestOtp(rawPhone, purpose, ttlSeconds);
  }
}

/* -------------------------------------------------------------------------- */
/*                            Singleton for API routes                        */
/* -------------------------------------------------------------------------- */

export const otpService = new OtpService();