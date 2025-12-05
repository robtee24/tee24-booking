// app/api/admin/bookings/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminUpdateBooking, cancelBooking } from "@/services/booking.service";

export const dynamic = "force-dynamic";

// PATCH /api/admin/bookings/[id] – Update booking (time, bay, customer info)
export async function PATCH(req: NextRequest) {
  try {
    const id = req.nextUrl.pathname.split("/").pop();

    if (!id || id === "[id]") {
      return new NextResponse("Invalid or missing booking ID", { status: 400 });
    }

    const body = await req.json();

    const updated = await adminUpdateBooking({
      bookingId: id,
      startLocal: body.startLocal,
      endLocal: body.endLocal,
      bayId: body.bayId,
      firstName: body.firstName?.trim(),
      lastName: body.lastName?.trim() || undefined,
      email: body.email?.trim() || null,
      phone: body.phone?.trim() || null,
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("[PATCH /api/admin/bookings/[id]] Error:", err);

    if (err.message?.toLowerCase().includes("overlap") || err.message?.toLowerCase().includes("conflict")) {
      return new NextResponse(err.message, { status: 409 });
    }

    return new NextResponse(err.message || "Failed to update booking", { status: 400 });
  }
}

// DELETE /api/admin/bookings/[id] – Cancel booking
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.pathname.split("/").pop();

    if (!id || id === "[id]") {
      return new NextResponse("Invalid or missing booking ID", { status: 400 });
    }

    await cancelBooking(id);
    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    console.error("[DELETE /api/admin/bookings/[id]] Error:", err);
    return new NextResponse(err.message || "Failed to cancel booking", { status: 400 });
  }
}