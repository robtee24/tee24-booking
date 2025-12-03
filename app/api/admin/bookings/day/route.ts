// app/api/admin/bookings/day/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getBookingsForAdminDay } from "@/services/booking.service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const date = searchParams.get("date");
    const locationSlug = searchParams.get("locationSlug");

    if (!date || !locationSlug) {
      return new NextResponse("Missing date or locationSlug", { status: 400 });
    }

    const result = await getBookingsForAdminDay(locationSlug, date);

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Admin day view error:", err);
    const status = err.message.includes("not found") ? 404 : 400;
    return new NextResponse(err.message || "Server error", { status });
  }
}