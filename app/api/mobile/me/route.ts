// GET /api/mobile/me — everything the app needs to render after launch:
// member, membership + visit allowance, facilities, bound device, next booking.
import { getMemberHome } from "@/services/mobile-member.service";
import { ok, withMobileAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("me", async (_req, auth) => {
  const home = await getMemberHome(auth.memberId);
  return ok(home);
});
