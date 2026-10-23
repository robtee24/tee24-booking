// POST /api/mobile/door/unlock { lat, lng, accuracy?, locationId?, doorId? }
// 200 { ok, door, location, visitId, allowance }   403 { code: OUT_OF_RANGE | QUOTA_EXCEEDED | ... , status }
import { parseGeo, unlockDoorForMember } from "@/services/mobile-door.service";
import { ok, readJson, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withMobileAuth("door/unlock", async (req, auth) => {
  const body = await readJson<Record<string, unknown>>(req);
  const geo = parseGeo(body);
  const result = await unlockDoorForMember(auth.memberId, {
    locationId: typeof body.locationId === "string" ? body.locationId : null,
    doorId: typeof body.doorId === "string" ? body.doorId : null,
    geo,
  });
  return ok(result);
});
