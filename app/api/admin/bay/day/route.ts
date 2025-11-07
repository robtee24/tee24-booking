// app/api/bay/day/route.ts
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id")?.trim() || "";
    const d = url.searchParams.get("d") || undefined;

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    // --- date helpers ---
    const nyISO = (date = new Date()) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);

    const coerceDay = (iso?: string | null) => {
      const today = nyISO();
      if (!iso) return today;
      return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : today;
    };

    const dateISO = coerceDay(d);
    const start = new Date(`${dateISO}T00:00:00-05:00`);
    const end = new Date(`${dateISO}T23:59:59-05:00`);

    // --- bay lookup ---
    const bay = await getPrisma().bay.findUnique({
      where: { id },
      select: { id: true, number: true, name: true, locationId: true },
    });

    if (!bay) {
      return NextResponse.json({ error: "Bay not found" }, { status: 404 });
    }

    // --- bookings for that bay on that day ---
    const bookings = await getPrisma().booking.findMany({
      where: {
        locationId: bay.locationId,
        bayNumber: bay.number,
        canceledAt: null,
        start: { lt: end },
        end: { gt: start },
      },
      orderBy: { start: "asc" },
      select: {
        id: true,
        start: true,
        end: true,
        firstName: true,
        lastName: true,
      },
    });

    return NextResponse.json({
      bay,
      dateISO,
      bookings: bookings.map((b) => ({
        id: b.id,
        start: b.start.toISOString(),
        end: b.end.toISOString(),
        firstName: b.firstName,
        lastName: b.lastName,
      })),
    });
  } catch (err: any) {
    console.error("GET /api/bay/day error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
