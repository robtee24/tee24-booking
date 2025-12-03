// app/api/admin/bookings/update/route.ts
import { NextRequest, NextResponse } from "next/server";
import { updateBooking } from "@/services/booking.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      id,
      bayId,
      startISO,   // treated as local time
      endISO,     // treated as local time
      firstName,
      lastName,
      email,
      phone,
    } = body;

    if (!id) {
      return new NextResponse("Missing booking ID", { status: 400 });
    }

    const updated = await updateBooking({
      bookingId: id,
      startLocal: startISO,
      endLocal: endISO,
      bayId: bayId ?? undefined,
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      email: email ?? undefined,
      phone: phone ?? undefined,
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("Update booking error:", err);

    // Preserve helpful conflict messages
    if (err.message.includes("overlaps")) {
      return new NextResponse(err.message, { status: 409 });
    }

    return new NextResponse(err.message || "Failed to update booking", { status: 400 });
  }
}