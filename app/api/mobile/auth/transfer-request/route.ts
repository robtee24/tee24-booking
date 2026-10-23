// POST /api/mobile/auth/transfer-request { phone, verificationToken, deviceId, deviceName, deviceModel, platform, note? }
// Files a DeviceTransferRequest (after the phone was verified by OTP moments ago).
import { NextRequest } from "next/server";
import { toE164 } from "@/lib/phone";
import { MOBILE_TRANSFER_AUDIENCE, verifyPhoneVerificationToken } from "@/lib/phone-verification";
import { cleanDevice, findMemberByPhone, requestDeviceTransfer } from "@/services/mobile-auth.service";
import { fail, handleError, ok, readJson } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await readJson<Record<string, unknown>>(req);
    const phone = String(body.phone ?? "");
    let e164: string;
    try {
      e164 = toE164(phone);
    } catch {
      return fail("Enter a valid 10-digit mobile number.", 400, "PHONE_INVALID");
    }
    const verified = await verifyPhoneVerificationToken(typeof body.verificationToken === "string" ? body.verificationToken : null, e164, MOBILE_TRANSFER_AUDIENCE);
    if (!verified) return fail("Please verify your number again before requesting a transfer.", 401, "VERIFICATION_EXPIRED");

    const member = await findMemberByPhone(e164);
    if (!member) return fail("We couldn't find a member with that mobile number.", 404, "MEMBER_NOT_FOUND");
    const device = cleanDevice(body);
    const { request, created } = await requestDeviceTransfer(member.id, device, typeof body.note === "string" ? body.note : null);
    return ok({ requestId: request.id, status: request.status, created });
  } catch (err) {
    return handleError(err, "auth/transfer-request");
  }
}
