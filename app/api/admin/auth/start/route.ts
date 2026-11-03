// app/api/admin/auth/start/route.ts
//
// Public (middleware allow-listed). Sends the admin login OTP.
//
// Hardening:
//   • Only phones that belong to an Admin row (or the ROOT bootstrap phone)
//     ever receive a text — this endpoint used to send to any number, which is
//     an SMS-pumping / cost-abuse vector. The response is identical either way
//     so it can't be used to enumerate admin phone numbers.
//   • Per-phone + per-IP send throttle via lib/otp-throttle.
import { NextResponse } from "next/server";
import { otpService } from "@/services/otp.service";
import { getPrisma } from "@/lib/db";
import { ENV } from "@/lib/env";
import { clientIp, otpSendAllowed } from "@/lib/otp-throttle";
import { toE164 } from "@/lib/phone";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const phone = (body as { phone?: unknown }).phone;

    if (!phone || typeof phone !== "string") {
      return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
    }

    let e164: string;
    try {
      e164 = toE164(phone);
    } catch {
      return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
    }

    const allowed = await otpSendAllowed(e164, clientIp(req.headers));
    if (!allowed.ok) {
      return NextResponse.json(
        { error: "Too many requests", retryInSeconds: allowed.retryInSeconds },
        { status: 429, headers: { "Retry-After": String(allowed.retryInSeconds) } },
      );
    }

    const ttlMs = (ENV.OTP_TTL ?? 300) * 1000;
    const genericExpiry = Date.now() + ttlMs;

    const isAdmin = !!(await getPrisma().admin.findUnique({ where: { phone: e164 }, select: { id: true } }));
    let isRootBootstrap = false;
    if (!isAdmin && ENV.ROOT_ADMIN_PHONE) {
      try {
        isRootBootstrap = toE164(ENV.ROOT_ADMIN_PHONE) === e164;
      } catch {
        isRootBootstrap = false;
      }
    }

    if (!isAdmin && !isRootBootstrap) {
      // Pretend we sent one. loginWithOtp will reject the verify step anyway.
      return NextResponse.json({ ok: true, expiresAt: genericExpiry });
    }

    const { expiresAt } = await otpService.requestOtp(e164, "admin_login");
    return NextResponse.json({ ok: true, expiresAt });
  } catch (err: unknown) {
    console.error("admin/auth/start error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
