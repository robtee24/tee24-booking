// app/api/admin/bookings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createBooking } from "@/services/booking.service";

export const dynamic = "force-dynamic";

// CREATE BOOKING
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const result = await createBooking({
      startLocal: body.startLocal ?? body.start,
      endLocal: body.endLocal ?? body.end,
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