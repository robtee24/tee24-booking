// app/api/bookings/otp/start/route.ts
import { NextResponse } from "next/server";
import { otpService } from "@/services/otp.service";

export async function POST(req: Request) {
  try {
    const { phone } = await req.json();
    if (!phone || typeof phone !== "string") {
      return NextResponse.json({ error: "Phone number required" }, { status: 400 });
    }

    const { expiresAt } = await otpService.requestOtp(phone, "customer_booking");

    return NextResponse.json({ ok: true, expiresAt });
  } catch (err: any) {
    console.error("Booking OTP start error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to send code" },
      { status: 400 }
    );
  }
}