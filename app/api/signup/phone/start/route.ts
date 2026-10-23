// POST /api/signup/phone/start { phone } → texts a 6-digit code to the number.
import { NextRequest, NextResponse } from "next/server";
import { otpService } from "@/services/otp.service";
import { clientIp, otpSendAllowed } from "@/lib/otp-throttle";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json().catch(() => ({}));
    if (!phone || typeof phone !== "string") return NextResponse.json({ error: "Phone number required" }, { status: 400 });
    const gate = await otpSendAllowed(phone, clientIp(req.headers));
    if (!gate.ok) return NextResponse.json({ error: `Please wait ${gate.retryInSeconds}s before requesting another code.` }, { status: 429 });
    const { expiresAt } = await otpService.requestOtp(phone, "customer_signup");
    return NextResponse.json({ ok: true, expiresAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send code";
    return NextResponse.json({ error: message === "Invalid phone number" ? "Enter a valid 10-digit mobile number." : message }, { status: 400 });
  }
}
