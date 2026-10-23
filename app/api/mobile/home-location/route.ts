// PUT /api/mobile/home-location { locationId } — default facility for booking/unlock
import { setHomeLocation } from "@/services/mobile-member.service";
import { fail, ok, readJson, withMobileAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PUT = withMobileAuth("home-location", async (req, auth) => {
  const { locationId } = await readJson<{ locationId?: string }>(req);
  if (!locationId) return fail("locationId required", 400, "BAD_REQUEST");
  return ok(await setHomeLocation(auth.memberId, locationId));
});
