// POST /api/mobile/auth/verify { phone, code, deviceId, deviceName, deviceModel, platform, osVersion, appVersion }
//
//  200 { ok, token, expiresAt, member }            — signed in (device bound or already bound)
//  409 { ok:false, code:"DEVICE_MISMATCH", ... }  — number is linked to another phone; the
//      response carries a short-lived `verificationToken` so the app can file a
//      transfer request without another text.
import { NextRequest } from "next/server";
import { otpService } from "@/services/otp.service";
import { toE164 } from "@/lib/phone";
import { isAppReviewCode, isAppReviewPhone } from "@/lib/app-review";
import { issuePhoneVerificationToken, MOBILE_TRANSFER_AUDIENCE } from "@/lib/phone-verification";
import { cleanDevice, completeSignIn, findMemberByPhone, unlockMemberDevice } from "@/services/mobile-auth.service";
import { clientIp, fail, handleError, ok, readJson } from "../../_shared";
import { getMemberHome } from "@/services/mobile-member.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await readJson<Record<string, unknown>>(req);
    const phone = String(body.phone ?? "");
    const code = String(body.code ?? "");
    if (!phone || !code) return fail("Phone and code required", 400, "BAD_REQUEST");
    const device = cleanDevice(body);

    let e164: string;
    try {
      e164 = toE164(phone);
    } catch {
      return fail("Enter a valid 10-digit mobile number.", 400, "PHONE_INVALID");
    }

    // App Store review account: fixed code instead of a texted OTP, and never
    // pinned to one device so any reviewer's phone can sign in.
    const review = isAppReviewPhone(e164);
    const result = review ? ({ ok: isAppReviewCode(e164, code), reason: "INVALID" } as const) : await otpService.verifyOtp(e164, code);
    if (!result.ok) {
      return fail(
        result.reason === "EXPIRED" ? "That code expired — request a new one." : "That code isn't right. Check the text and try again.",
        401,
        result.reason === "EXPIRED" ? "CODE_EXPIRED" : "CODE_INVALID",
      );
    }

    const member = await findMemberByPhone(e164);
    if (!member) return fail("We couldn't find a member with that mobile number.", 404, "MEMBER_NOT_FOUND");
    if (member.status === "CANCELLED") {
      return fail("This membership is cancelled. Rejoin at tee24.golf or text us at (502) 410-2382.", 403, "MEMBERSHIP_CANCELLED");
    }

    if (review) await unlockMemberDevice(member.id, null, "member_signout");
    const signIn = await completeSignIn(member.id, device, clientIp(req));
    if (!signIn.ok) {
      const verificationToken = await issuePhoneVerificationToken(e164, MOBILE_TRANSFER_AUDIENCE);
      return fail(
        "This phone number is already registered to a different device.",
        409,
        "DEVICE_MISMATCH",
        {
          boundDevice: { name: signIn.boundDevice.name, model: signIn.boundDevice.model, boundAt: signIn.boundDevice.boundAt.toISOString() },
          pendingRequestId: signIn.pendingRequestId,
          verificationToken,
        },
      );
    }

    const home = await getMemberHome(member.id);
    return ok({ token: signIn.token, expiresAt: signIn.expiresAt.toISOString(), bound: signIn.bound, ...home });
  } catch (err) {
    return handleError(err, "auth/verify");
  }
}
