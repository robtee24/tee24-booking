// app/api/admin/bookings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createBooking } from "@/services/booking.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const result = await createBooking({
      // Time strings — local time, no Z
      startLocal: body.startISO ?? body.start,
      endLocal: body.endISO ?? body.end,

      // Location — accept both slug and direct ID (admin often has ID)
      locationId: body.locationId,
      locationSlug: body.locationSlug ?? body.slug,

      // Bay — admin must specify one of these
      bayId: body.bayId ?? body.bayID ?? undefined,
      bayNumber: body.bayNumber ?? body.bay_no ?? undefined,

      // Guest
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone ?? body.phoneNumber,

      // Admin doesn't use partyKind/handedness → ignored by service
      source: "ADMIN",
    });

    return NextResponse.json({
      ok: true,
      booking: result,
    });
  } catch (err: any) {
    console.error("Admin booking create error:", err);

    return NextResponse.json(
      {
        ok: false,
        error: err.message || "Failed to create booking",
      },
      { status: 400 }
    );
  }
}