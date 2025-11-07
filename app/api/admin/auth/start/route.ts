// app/api/admin/auth/start/route.ts
import { NextResponse } from "next/server";
import { ENV } from "@/lib/env";
import { createOtp, normalizePhone } from "@/lib/otp";
import { sendSms } from "@/lib/openphone";


export const runtime = "nodejs"; // ensure Node env for process.env

// simple per-IP throttle map (dev-only)
const throttle = new Map<string, number>();

export async function POST(req: Request) {
  try {
    // --- throttle: 1 request / 3 seconds per IP (dev safeguard) ---
    const ip =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "local";
    const now = Date.now();
    const last = throttle.get(ip) ?? 0;
    if (now - last < 3000) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    throttle.set(ip, now);

    const { phone: rawPhone } = await req.json().catch(() => ({ phone: "" }));
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
    }

    // create OTP (default TTL from ENV.OTP_TTL seconds)
    const { code, expiresAt } = await createOtp(phone, ENV.OTP_TTL || 300);

    // compose SMS text
    const msg = `Your Tee24 admin login code is ${code}. It expires in ${Math.floor(
      (ENV.OTP_TTL || 300) / 60
    )} min. If you didn’t request this, ignore.`;

    // send via OpenPhone
    await sendSms({
      from: ENV.OPENPHONE_NUMBER, // e.g. +15025551234
      to: [phone],                // OpenPhone expects an array of recipients
      content: msg,
    });

    return NextResponse.json({ ok: true, expiresAt });
  } catch (err) {
    console.error("auth/start error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
