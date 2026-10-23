// GET  /api/mobile/bookings                → { upcoming, past }
// POST /api/mobile/bookings { locationSlug, startLocal, endLocal, partyKind, handedness, guests }
//      → 402 MEMBERSHIP_INACTIVE { access } when the member has no active membership/pass
import { createMemberBooking, listMemberBookings } from "@/services/mobile-booking.service";
import { fail, ok, readJson, withMobileAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("bookings", async (_req, auth) => ok(await listMemberBookings(auth.memberId)));

export const POST = withMobileAuth("bookings", async (req, auth) => {
  const body = await readJson<Record<string, unknown>>(req);
  const locationSlug = String(body.locationSlug ?? "").trim();
  const startLocal = String(body.startLocal ?? body.startISO ?? "").trim();
  const endLocal = String(body.endLocal ?? body.endISO ?? "").trim();
  if (!locationSlug || !startLocal || !endLocal) return fail("locationSlug, startLocal and endLocal required", 400, "BAD_REQUEST");
  const booking = await createMemberBooking(auth.memberId, {
    locationSlug,
    startLocal,
    endLocal,
    partyKind: body.partyKind === "SINGLE" ? "SINGLE" : "GROUP",
    handedness: body.handedness === "LH" ? "LH" : "RH",
    guests: typeof body.guests === "number" ? body.guests : Number(body.guests ?? 0),
  });
  return ok({ booking: { ...booking, start: booking.start.toISOString(), end: booking.end.toISOString() } });
});
