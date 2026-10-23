// GET /api/mobile/door/status?lat=&lng=&accuracy=&locationId=
// Pre-flight for the Unlock screen: nearest facility, distance, allowance, doors.
import { getDoorStatus, parseGeo } from "@/services/mobile-door.service";
import { ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("door/status", async (req, auth) => {
  const sp = req.nextUrl.searchParams;
  const geo = parseGeo({ lat: sp.get("lat"), lng: sp.get("lng"), accuracy: sp.get("accuracy") });
  const status = await getDoorStatus(auth.memberId, { locationId: sp.get("locationId"), geo });
  return ok({ status });
});
