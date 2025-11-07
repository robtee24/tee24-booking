// app/schedule-data/route.ts
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /schedule-data?slug=<locationSlug>&d=YYYY-MM-DD
 * Returns:
 * {
 *   locationName, locationSlug, dateISO,
 *   bays: [{id,number,name}],
 *   bookings: [{id, bayNumber, start, end, firstName, lastName}]
 * }
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug")?.trim() || "";
    const d = url.searchParams.get("d") || undefined;

    if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });

    const nyISO = (date = new Date()) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);

    const dateISO = /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? String(d) : nyISO();

    // Note: using fixed -05:00 offset in this app (consistent with your other routes)
    const start = new Date(`${dateISO}T00:00:00-05:00`);
    const end   = new Date(`${dateISO}T23:59:59-05:00`);

    const location = await getPrisma().location.findUnique({
      where: { slug },
      select: {
        id: true, name: true, slug: true,
        bays: { select: { id: true, number: true, name: true } }
      }
    });
    if (!location) return NextResponse.json({ error: "Location not found" }, { status: 404 });

    const bays = [...location.bays].sort((a, b) => a.number - b.number);

    const bookings = await getPrisma().booking.findMany({
      where: {
        locationId: location.id,
        canceledAt: null,
        start: { lt: end },
        end:   { gt: start },
      },
      orderBy: [{ bayNumber: "asc" }, { start: "asc" }],
      select: { id: true, bayNumber: true, start: true, end: true, firstName: true, lastName: true },
    });

    return NextResponse.json({
      locationName: location.name,
      locationSlug: location.slug,
      dateISO,
      bays,
      bookings: bookings.map(b => ({
        id: b.id,
        bayNumber: b.bayNumber,
        start: b.start.toISOString(),
        end: b.end.toISOString(),
        firstName: b.firstName,
        lastName: b.lastName,
      })),
    });
  } catch (err: any) {
    console.error("GET /schedule-data error:", err?.stack || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
