// app/api/bookings/otp/verify/route.ts
import { NextResponse } from "next/server";
import { otpService } from "@/services/otp.service";

export async function POST(req: Request) {
  try {
    const { phone, code } = await req.json();
    if (!phone || !code) {
      return NextResponse.json({ error: "Phone and code required" }, { status: 400 });
    }

    const result = await otpService.verifyOtp(phone, code);
    if (!result.ok) {
      return NextResponse.json(
        { error: "Invalid or expired code" },
        { status: 401 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Booking OTP verify error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}