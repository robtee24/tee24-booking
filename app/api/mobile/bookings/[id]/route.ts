// DELETE /api/mobile/bookings/:id — cancel one of my reservations
import { cancelMemberBooking } from "@/services/mobile-booking.service";
import { ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = withMobileAuth<{ params: Promise<{ id: string }> }>("bookings/cancel", async (_req, auth, ctx) => {
  const { id } = await ctx.params;
  return ok(await cancelMemberBooking(auth.memberId, id));
});
