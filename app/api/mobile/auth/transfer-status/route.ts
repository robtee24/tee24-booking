// GET /api/mobile/auth/transfer-status?requestId=&deviceId=&phone=&verificationToken=
// Polled by the app while a transfer request is pending. Once approved (and the
// phone-verification token is still fresh) it returns a session token so the
// member lands in the app without another text.
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import { MOBILE_TRANSFER_AUDIENCE, verifyPhoneVerificationToken } from "@/lib/phone-verification";
import { completeSignIn } from "@/services/mobile-auth.service";
import { clientIp, fail, handleError, ok } from "../../_shared";
import { getMemberHome } from "@/services/mobile-member.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const requestId = sp.get("requestId")?.trim();
    const deviceId = sp.get("deviceId")?.trim();
    if (!requestId || !deviceId) return fail("requestId and deviceId required", 400, "BAD_REQUEST");

    const request = await getPrisma().deviceTransferRequest.findUnique({
      where: { id: requestId },
      include: { member: { select: { id: true, phone: true } } },
    });
    if (!request || request.toDeviceId !== deviceId) return fail("Request not found", 404, "NOT_FOUND");

    if (request.status !== "APPROVED") {
      return ok({ status: request.status, resolutionNote: request.status === "DENIED" ? request.resolutionNote : null });
    }

    // Approved → try to finish sign-in silently if the OTP proof is still fresh.
    const phone = sp.get("phone");
    const token = sp.get("verificationToken");
    let verified: string | null = null;
    if (phone && token) {
      try {
        verified = await verifyPhoneVerificationToken(token, toE164(phone), MOBILE_TRANSFER_AUDIENCE);
      } catch {
        verified = null;
      }
    }
    if (!verified) return ok({ status: "APPROVED", signIn: "REVERIFY" });

    const result = await completeSignIn(
      request.member.id,
      { deviceId, platform: request.toPlatform, name: request.toDeviceName, model: request.toDeviceModel },
      clientIp(req),
    );
    if (!result.ok) return ok({ status: "APPROVED", signIn: "REVERIFY" });
    const home = await getMemberHome(request.member.id);
    return ok({ status: "APPROVED", signIn: "DONE", token: result.token, expiresAt: result.expiresAt.toISOString(), ...home });
  } catch (err) {
    return handleError(err, "auth/transfer-status");
  }
}
