// app/api/admin/bookings/update/route.ts
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

/**
 * Supports both drag-move and full edits.
 * Runs an overlap check against other bookings in the same location + bay.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      id,
      bayId,           // optional (if omitted, keep current)
      startISO,        // optional (if omitted, keep current)
      endISO,          // optional (if omitted, keep current)
      firstName,       // optional
      lastName,        // optional
      email,           // optional
      phone,           // optional
    } = body;

    if (!id) return new NextResponse("Missing id", { status: 400 });

    // Load current booking to know locationId & existing times/bayNumber
    const current = await getPrisma().booking.findUnique({ where: { id } });
    if (!current) return new NextResponse("Not found", { status: 404 });

    // Determine target bayNumber
    let bayNumber = current.bayNumber;
    if (bayId) {
      const bay = await getPrisma().bay.findUnique({ where: { id: bayId } });
      if (!bay) return new NextResponse("Invalid bay", { status: 400 });
      bayNumber = bay.number;
    }

    // Determine target times
    let start = current.start;
    let end = current.end;

    if (startISO) {
      const s = new Date(startISO);
      if (!(s instanceof Date) || isNaN(s.getTime())) return new NextResponse("Invalid start time", { status: 400 });
      start = s;
    }
    if (endISO) {
      const e = new Date(endISO);
      if (!(e instanceof Date) || isNaN(e.getTime())) return new NextResponse("Invalid end time", { status: 400 });
      end = e;
    }
    if (end <= start) return new NextResponse("End must be after start", { status: 400 });

    // --- collision check (exclude self) ---
    const conflict = await getPrisma().booking.findFirst({
      where: {
        locationId: current.locationId,
        bayNumber,
        canceledAt: null,
        id: { not: id },
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

    const data: any = {
      bayNumber,
      start,
      end,
    };
    if (typeof firstName === "string") data.firstName = firstName;
    if (typeof lastName === "string") data.lastName = lastName;
    if (typeof email === "string") data.email = email;
    if (typeof phone === "string") data.phone = phone;

    const updated = await getPrisma().booking.update({
      where: { id },
      data,
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("Update booking error:", err);
    return new NextResponse(err?.message || "Internal Server Error", { status: 500 });
  }
}

