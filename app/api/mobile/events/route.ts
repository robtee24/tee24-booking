// GET /api/mobile/events?locationId=&includePast=1
import { listEventsForMember } from "@/services/mobile-events.service";
import { ok, withMobileAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("events", async (req, auth) => {
  const sp = req.nextUrl.searchParams;
  const events = await listEventsForMember(auth.memberId, { locationId: sp.get("locationId"), includePast: sp.get("includePast") === "1" });
  return ok({ events });
});
