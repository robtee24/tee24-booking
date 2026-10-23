// POST /api/mobile/auth/logout — revoke this session. The device stays linked
// to the member (one-phone policy); signing back in on the same phone is instant
// after an OTP.
import { revokeSession } from "@/lib/mobile-session";
import { ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withMobileAuth("auth/logout", async (_req, auth) => {
  await revokeSession(auth.sessionId);
  return ok({});
});
