// lib/otp.ts
import { randomInt } from "crypto";
import { ENV } from "@/lib/env";
import { getPrisma } from "@/lib/db";

const TTL = ENV.OTP_TTL || 300;

export function normalizePhone(input: string): string {
  const digits = (input || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function createOtp(phone: string, ttlSeconds = TTL) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await getPrisma().otp.upsert({
    where: { phone },
    update: { code, expiresAt },
    create: { phone, code, expiresAt },
  });

  return { code, expiresAt: expiresAt.getTime() };
}

export async function verifyOtp(phone: string, code: string) {
  const record = await getPrisma().otp.findUnique({ where: { phone } });

  if (!record) return { ok: false, reason: "NOT_FOUND" as const };

  if (new Date() > record.expiresAt) {
    await getPrisma().otp.delete({ where: { phone } });
    return { ok: false, reason: "EXPIRED" as const };
  }

  if (record.code !== code) return { ok: false, reason: "MISMATCH" as const };

  await getPrisma().otp.delete({ where: { phone } });
  return { ok: true };
}

export async function ttlRemaining(phone: string): Promise<number> {
  const record = await getPrisma().otp.findUnique({
    where: { phone },
    select: { expiresAt: true },
  });
  if (!record) return 0;
  return Math.max(0, Math.ceil((record.expiresAt.getTime() - Date.now()) / 1000));
}