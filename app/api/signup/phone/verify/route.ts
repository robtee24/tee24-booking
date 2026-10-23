// POST /api/signup/phone/verify { phone, code } → { ok, phone, phoneToken }
// The token is bound to the number and must accompany the signup submission.
import { NextRequest, NextResponse } from "next/server";
import { otpService } from "@/services/otp.service";
import { issuePhoneVerificationToken, SIGNUP_PHONE_AUDIENCE } from "@/lib/phone-verification";
import { toE164 } from "@/lib/phone";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { phone, code } = await req.json().catch(() => ({}));
    if (!phone || !code) return NextResponse.json({ error: "Phone and code required" }, { status: 400 });
    const result = await otpService.verifyOtp(String(phone), String(code));
    if (!result.ok) {
      const msg = result.reason === "EXPIRED" ? "That code expired — request a new one." : "That code isn't right. Check the text and try again.";
      return NextResponse.json({ error: msg }, { status: 401 });
    }
    const e164 = toE164(String(phone));
    const phoneToken = await issuePhoneVerificationToken(e164, SIGNUP_PHONE_AUDIENCE);
    return NextResponse.json({ ok: true, phone: e164, phoneToken });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 400 });
  }
}
