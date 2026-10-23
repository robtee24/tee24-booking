// GET /api/mobile/bookings/access → { access } — can this member reserve, and on what guest terms?
import { getBookingAccess } from "@/services/mobile-booking-access.service";
import { ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("bookings/access", async (_req, auth) => ok({ access: await getBookingAccess(auth.memberId) }));
