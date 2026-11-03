// app/api/bookings/otp/start/route.ts
// POST { phone } → texts a 6-digit code so a guest can manage their booking.
// Public endpoint: throttled per phone + per IP like the other OTP senders so
// it can't be used to pump SMS to arbitrary numbers.
import { NextResponse } from "next/server";
import { otpService } from "@/services/otp.service";
import { clientIp, otpSendAllowed } from "@/lib/otp-throttle";
import { toE164 } from "@/lib/phone";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { phone } = await req.json().catch(() => ({} as { phone?: unknown }));
    if (!phone || typeof phone !== "string") {
      return NextResponse.json({ error: "Phone number required" }, { status: 400 });
    }
    let e164: string;
    try {
      e164 = toE164(phone);
    } catch {
      return NextResponse.json({ error: "Enter a valid 10-digit mobile number." }, { status: 400 });
    }

    const gate = await otpSendAllowed(e164, clientIp(req.headers));
    if (!gate.ok) {
      return NextResponse.json(
        { error: `Please wait ${gate.retryInSeconds}s before requesting another code.` },
        { status: 429, headers: { "Retry-After": String(gate.retryInSeconds) } },
      );
    }

    const { expiresAt } = await otpService.requestOtp(e164, "customer_booking");
    return NextResponse.json({ ok: true, expiresAt });
  } catch (err: unknown) {
    console.error("Booking OTP start error:", err);
    return NextResponse.json({ error: "Failed to send code" }, { status: 400 });
  }
}
