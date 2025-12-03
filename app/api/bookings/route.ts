// app/api/bookings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createBooking } from "@/services/booking.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const result = await createBooking({
      startLocal: body.startISO ?? body.start,
      endLocal: body.endISO ?? body.end,

      locationSlug: body.locationSlug ?? body.slug,

      // Optional: bayId or bayNumber can be passed, but not required (auto-assign)
      bayId: body.bayId ?? body.bayID ?? undefined,
      bayNumber: body.bayNumber ?? body.bay_no ?? undefined,

      firstName: body.firstName,
      lastName: body.lastName,

      email: body.email,
      phone: body.phone,

      // Public-specific: party type & handedness
      partyKind: body.partyKind === "SINGLE" ? "SINGLE" : "GROUP",
      handedness: body.handedness === "LH" ? "LH" : "RH",

      source: "PUBLIC",
    });

    return NextResponse.json({ ok: true, booking: result });
  } catch (err: any) {
    console.error("Public booking error:", err);

    // Optional: preserve debug info on "no bay free" (you had this before)
    if (err.message.includes("No eligible bay") || err.message.includes("No bay free")) {
      return NextResponse.json(
        {
          ok: false,
          error: err.message,
          debug: err.debug || null,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { ok: false, error: err.message || "Failed to create booking" },
      { status: 400 }
    );
  }
}