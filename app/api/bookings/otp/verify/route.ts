import { NextResponse } from "next/server";
import { otpService } from "@/services/otp.service";
import { BOOKING_PHONE_AUDIENCE, issuePhoneVerificationToken } from "@/lib/phone-verification";
import { lookupBookingIdentity } from "@/services/booking-identity.service";

export async function POST(req: Request) {
  try {
    const { phone, code, locationSlug } = await req.json();
    if (!phone || !code) {
      return NextResponse.json({ error: "Phone and code required" }, { status: 400 });
    }

    const result = await otpService.verifyOtp(phone, code);
    if (!result.ok) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
    }

    const phoneToken = await issuePhoneVerificationToken(phone, BOOKING_PHONE_AUDIENCE);
    const identity = await lookupBookingIdentity(phone, typeof locationSlug === "string" ? locationSlug : null);
    return NextResponse.json({ ok: true, phoneToken, ...identity });
  } catch (err) {
    console.error("Booking OTP verify error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
