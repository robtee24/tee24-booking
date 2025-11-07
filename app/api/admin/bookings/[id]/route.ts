// app/api/admin/bookings/route.ts
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

/**
 * Overlap rule:
 * Two bookings overlap if:
 *   newStart < existing.end  AND  newEnd > existing.start
 * (same location + same bayNumber)
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      locationId,
      bayId,           // required
      firstName,
      lastName,
      email,
      phone,
      startISO,        // required
      endISO,          // required
    } = body;

    if (!locationId || !bayId || !startISO || !endISO || !firstName || !lastName) {
      return new NextResponse("Missing required fields", { status: 400 });
    }

    const bay = await getPrisma().bay.findUnique({ where: { id: bayId } });
    if (!bay) return new NextResponse("Invalid bay", { status: 400 });

    const start = new Date(startISO);
    const end = new Date(endISO);
    if (!(start instanceof Date) || isNaN(start.getTime()) || !(end instanceof Date) || isNaN(end.getTime())) {
      return new NextResponse("Invalid dates", { status: 400 });
    }
    if (end <= start) return new NextResponse("End must be after start", { status: 400 });

    // --- collision check ---
    const conflict = await getPrisma().booking.findFirst({
      where: {
        locationId,
        bayNumber: bay.number,
        canceledAt: null,
        start: { lt: end },   // existing.start < newEnd
        end:   { gt: start }, // existing.end   > newStart
      },
      select: { id: true, firstName: true, lastName: true, start: true, end: true },
    });

    if (conflict) {
      return new NextResponse(
        `Booking overlaps another reservation (${conflict.firstName} ${conflict.lastName} ${new Date(conflict.start).toISOString()}–${new Date(conflict.end).toISOString()}).`,
        { status: 409 }
      );
    }

    const created = await getPrisma().booking.create({
      data: {
        locationId,
        bayNumber: bay.number,
        firstName,
        lastName,
        email,
        phone,
        start,
        end,
      },
    });

    return NextResponse.json(created);
  } catch (err: any) {
    console.error("Create booking error:", err);
    return new NextResponse(err?.message || "Failed to create booking", { status: 500 });
  }
}
