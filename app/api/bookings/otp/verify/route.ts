// app/api/bookings/otp/verify/route.ts
// POST { phone, code } → { ok, phoneToken }
// The phoneToken is short-lived proof that this number was verified; POST
// /api/bookings requires it so a booking can't be created for an unverified
// (or someone else's) phone number by calling the API directly.
import { NextResponse } from "next/server";
import { otpService } from "@/services/otp.service";
import { BOOKING_PHONE_AUDIENCE, issuePhoneVerificationToken } from "@/lib/phone-verification";
import { toE164 } from "@/lib/phone";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { phone, code } = await req.json().catch(() => ({} as { phone?: unknown; code?: unknown }));
    if (!phone || !code || typeof phone !== "string") {
      return NextResponse.json({ error: "Phone and code required" }, { status: 400 });
    }

    const result = await otpService.verifyOtp(phone, String(code));
    if (!result.ok) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
    }

    const e164 = toE164(phone);
    const phoneToken = await issuePhoneVerificationToken(e164, BOOKING_PHONE_AUDIENCE);
    return NextResponse.json({ ok: true, phoneToken });
  } catch (err: unknown) {
    console.error("Booking OTP verify error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
