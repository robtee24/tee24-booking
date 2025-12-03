// app/api/admin/bookings/delete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cancelBooking } from "@/services/booking.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id } = body;

    if (!id || typeof id !== "string") {
      return new NextResponse("Missing or invalid booking ID", { status: 400 });
    }

    await cancelBooking(id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Cancel booking error:", err);

    if (err.message.includes("not found") || err.message.includes("already canceled")) {
      return new NextResponse(err.message, { status: 404 });
    }

    return new NextResponse(err.message || "Failed to cancel booking", { status: 500 });
  }
}