// POST /api/mobile/auth/start { phone }
// Texts a sign-in code to a member's mobile. Always 200 for well-formed
// numbers (no account enumeration); the SMS only goes out when a member with
// that number exists.
import { NextRequest } from "next/server";
import { otpService } from "@/services/otp.service";
import { toE164 } from "@/lib/phone";
import { clientIp, otpSendAllowed } from "@/lib/otp-throttle";
import { fail, handleError, ok, readJson } from "../../_shared";
import { findMemberByPhone } from "@/services/mobile-auth.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { phone } = await readJson<{ phone?: string }>(req);
    if (!phone || typeof phone !== "string") return fail("Phone number required", 400, "PHONE_REQUIRED");
    let e164: string;
    try {
      e164 = toE164(phone);
    } catch {
      return fail("Enter a valid 10-digit mobile number.", 400, "PHONE_INVALID");
    }
    const gate = await otpSendAllowed(e164, clientIp(req.headers));
    if (!gate.ok) return fail(`Please wait ${gate.retryInSeconds}s before requesting another code.`, 429, "RATE_LIMITED", { retryInSeconds: gate.retryInSeconds });

    const member = await findMemberByPhone(e164);
    if (member) await otpService.requestOtp(e164, "mobile_login");
    return ok({ phone: e164 });
  } catch (err) {
    return handleError(err, "auth/start");
  }
}
