// app/api/admin/bookings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createBooking, adminUpdateBooking } from "@/services/booking.service";

export const dynamic = "force-dynamic";

// CREATE BOOKING
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const result = await createBooking({
      startLocal: body.startISO ?? body.start,
      endLocal: body.endISO ?? body.end,
      locationId: body.locationId,
      locationSlug: body.locationSlug ?? body.slug,
      bayId: body.bayId ?? body.bayID,
      bayNumber: body.bayNumber ?? body.bay_no,
      firstName: body.firstName?.trim(),
      lastName: body.lastName?.trim() || undefined,
      email: body.email?.trim() || null,
      phone: (body.phone ?? body.phoneNumber)?.trim() || null,
      source: "ADMIN",
    });

    return NextResponse.json({ ok: true, booking: result });
  } catch (err: any) {
    console.error("Admin create booking error:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to create booking" },
      { status: 400 }
    );
  }
}

// UPDATE BOOKING
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.id) {
      return NextResponse.json(
        { ok: false, error: "Missing booking id" },
        { status: 400 }
      );
    }

    await adminUpdateBooking({
      bookingId: body.id,
      bayId: body.bayId ?? body.bayID,
      startLocal: body.startISO,
      endLocal: body.endISO,
      firstName: body.firstName?.trim(),
      lastName: body.lastName?.trim() || undefined,
      email: body.email?.trim() || null,
      phone: body.phone?.trim() || null,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Admin update booking error:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to update booking" },
      { status: 400 }
    );
  }
}

// DELETE BOOKING
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.id) {
      return NextResponse.json(
        { ok: false, error: "Missing booking id" },
        { status: 400 }
      );
    }

    const { cancelBooking } = await import("@/services/booking.service");
    await cancelBooking(body.id);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Admin delete booking error:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to delete booking" },
      { status: 400 }
    );
  }
}