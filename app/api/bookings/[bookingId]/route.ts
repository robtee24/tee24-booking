// app/api/bookings/[bookingId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { managementTokenMatches } from "@/lib/management-token";
import { cancelBooking } from "@/services/booking.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/bookings/[bookingId]?token=...
 * Guest self-service view. The management token from the confirmation link is
 * the credential; without it the route reveals nothing (not even existence).
 * Returns only what the manage page renders — never the token or internal ids.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ bookingId: string }> }
) {
  const { bookingId } = await context.params;
  const token = req.nextUrl.searchParams.get("token");

  const booking = await getPrisma().booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      start: true,
      end: true,
      bayNumber: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      canceledAt: true,
      managementToken: true,
      Location: { select: { name: true, slug: true, timezone: true } },
    },
  });

  if (!booking || !managementTokenMatches(booking.managementToken, token)) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const { managementToken: _token, ...safe } = booking;
  void _token;
  return NextResponse.json(safe);
}

/**
 * DELETE /api/bookings/[bookingId]?token=...
 * Guest self-service cancellation (soft delete). Requires the management token.
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ bookingId: string }> }
) {
  try {
    const { bookingId } = await context.params;
    const token = req.nextUrl.searchParams.get("token");

    const booking = await getPrisma().booking.findUnique({
      where: { id: bookingId },
      select: { id: true, managementToken: true, canceledAt: true },
    });

    if (!booking || !managementTokenMatches(booking.managementToken, token)) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    if (booking.canceledAt) {
      return NextResponse.json({ error: "Booking already canceled" }, { status: 410 });
    }

    // Use shared service → soft delete + future hooks
    await cancelBooking(bookingId);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("Guest cancel booking error:", err);
    return NextResponse.json({ error: "Failed to cancel booking" }, { status: 500 });
  }
}
