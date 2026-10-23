// GET /api/mobile/locations — facilities (public info + geofence + bay counts)
import { listMobileLocations } from "@/services/mobile-member.service";
import { ok, withMobileAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("locations", async () => ok({ locations: await listMobileLocations() }));
