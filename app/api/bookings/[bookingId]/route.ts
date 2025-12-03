// app/api/bookings/[bookingId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { cancelBooking } from "@/services/booking.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/bookings/[bookingId]
 * Public endpoint — returns booking + location name/slug
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ bookingId: string }> }
) {
  const { bookingId } = await context.params;

  const booking = await getPrisma().booking.findUnique({
    where: { id: bookingId },
    include: {
      location: {
        select: { name: true, slug: true, timezone: true },
      },
    },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  return NextResponse.json(booking);
}

/**
 * DELETE /api/bookings/[bookingId]?token=...
 * Guest self-service cancellation (soft delete)
 * Requires managementToken if set
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ bookingId: string }> }
) {
  try {
    const { bookingId } = await context.params;
    const token = req.nextUrl.searchParams.get("token") ?? undefined;

    const booking = await getPrisma().booking.findUnique({
      where: { id: bookingId },
      select: { id: true, managementToken: true, canceledAt: true },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    if (booking.canceledAt) {
      return NextResponse.json({ error: "Booking already canceled" }, { status: 410 });
    }

    // Enforce token if one was generated
    if (booking.managementToken && booking.managementToken !== token) {
      return NextResponse.json({ error: "Invalid or missing token" }, { status: 401 });
    }

    // Use shared service → soft delete + future hooks
    await cancelBooking(bookingId);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Guest cancel booking error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to cancel booking" },
      { status: 500 }
    );
  }
}