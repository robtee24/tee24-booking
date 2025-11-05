// app/api/admin/bookings/day/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    const locationSlug = searchParams.get("locationSlug");

    if (!date || !locationSlug) {
      return new NextResponse("Missing date or locationSlug", { status: 400 });
    }

    const location = await prisma.location.findUnique({
      where: { slug: locationSlug },
      include: { bays: true },
    });

    if (!location) {
      return new NextResponse("Location not found", { status: 404 });
    }

    const startOfDay = new Date(`${date}T00:00:00`);
    const endOfDay = new Date(`${date}T23:59:59`);

    const bookings = await prisma.booking.findMany({
      where: {
        locationId: location.id,
        OR: [
          { start: { gte: startOfDay, lte: endOfDay } },
          { end:   { gte: startOfDay, lte: endOfDay } },
        ],
      },
      orderBy: { start: "asc" },
    });

    const formattedBookings = bookings.map((b) => {
      const bay = location.bays.find((bay) => bay.number === b.bayNumber);
      return {
        id: b.id,
        bayId: bay ? bay.id : location.bays[0]?.id || "",
        locationId: b.locationId,
        firstName: b.firstName,
        lastName: b.lastName,
        email: b.email,
        phone: b.phone,
        start: b.start,
        end: b.end,
      };
    });

    return NextResponse.json({
      date,
      locationId: location.id,
      locationName: location.name,
      minBookingMinutes: location.minBookingMinutes ?? 60, // NEW
      bays: location.bays.map((b) => ({ id: b.id, number: b.number })),
      bookings: formattedBookings,
    });
  } catch (err: any) {
    console.error("Error in /bookings/day route:", err);
    return new NextResponse(err.message || "Internal Server Error", {
      status: 500,
    });
  }
}


