// app/api/admin/auth/start/route.ts
import { NextResponse } from "next/server";
import { otpService } from "@/services/otp.service";

export const runtime = "nodejs";

// Simple dev-only IP throttle (keep as-is or move to middleware later)
const throttle = new Map<string, number>();

export async function POST(req: Request) {
  try {
    // --- Throttle: 1 request per 3 seconds per IP ---
    const ip =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
    const now = Date.now();
    const last = throttle.get(ip) ?? 0;
    if (now - last < 3000) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429 }
      );
    }
    throttle.set(ip, now);

    const { phone } = await req.json();

    if (!phone || typeof phone !== "string") {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 }
      );
    }

    const { expiresAt } = await otpService.requestOtp(phone, "admin_login");

    return NextResponse.json({ ok: true, expiresAt });
  } catch (err: any) {
    console.error("admin/auth/start error:", err);
    const status = err.message === "Invalid phone number" ? 400 : 500;
    return NextResponse.json(
      { error: err.message || "Internal error" },
      { status }
    );
  }
}