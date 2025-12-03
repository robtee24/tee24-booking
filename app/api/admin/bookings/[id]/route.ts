// app/api/admin/bookings/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { updateBooking, cancelBooking } from "@/services/booking.service";

export const dynamic = "force-dynamic";

// UPDATE booking (PATCH)
export async function PATCH(req: NextRequest) {
  try {
    const { pathname } = req.nextUrl;
    const id = pathname.split("/").pop();

    if (!id) return new NextResponse("Missing booking ID", { status: 400 });

    const body = await req.json();

    const updated = await updateBooking({
      bookingId: id,
      startLocal: body.startISO,
      endLocal: body.endISO,
      bayId: body.bayId ?? undefined,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
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

// CANCEL booking (DELETE)
export async function DELETE(req: NextRequest) {
  try {
    const { pathname } = req.nextUrl;
    const id = pathname.split("/").pop();

    if (!id) return new NextResponse("Missing booking ID", { status: 400 });

    await cancelBooking(id);

    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    console.error("Cancel booking error:", err);
    return new NextResponse(err.message || "Failed to cancel booking", { status: 400 });
  }
}