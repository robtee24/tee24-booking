// GET /api/mobile/availability?locationSlug=&date=YYYY-MM-DD&kind=SINGLE|GROUP&hand=RH|LH
import { getMobileAvailability } from "@/services/mobile-booking.service";
import { fail, ok, withMobileAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("availability", async (req) => {
  const sp = req.nextUrl.searchParams;
  const locationSlug = sp.get("locationSlug")?.trim();
  const date = sp.get("date")?.trim();
  const kind = sp.get("kind")?.toUpperCase();
  const hand = sp.get("hand")?.toUpperCase();
  if (!locationSlug || !date) return fail("locationSlug and date required", 400, "BAD_REQUEST");
  if (kind !== "SINGLE" && kind !== "GROUP") return fail("kind must be SINGLE or GROUP", 400, "BAD_REQUEST");
  const result = await getMobileAvailability({ locationSlug, date, kind, hand: hand === "LH" ? "LH" : hand === "RH" ? "RH" : undefined });
  return ok({ availability: result });
});
