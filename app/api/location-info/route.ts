import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = (searchParams.get("locationSlug") || "").trim();

    if (!slug) {
      return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
    }

    const location = await getPrisma().location.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        bookingNote: true,
        minBookingMinutes: true,
        maxBookingMinutes: true,
        passAccessUrl: true, // <-- NEW
        bays: { select: { number: true } },
      },
    });

    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: location.id,
      name: location.name,
      slug: location.slug,
      bookingNote: location.bookingNote ?? "",
      // powers duration buttons on user booking page
      minBookingMinutes: location.minBookingMinutes,
      maxBookingMinutes: location.maxBookingMinutes,
      // constrains bay choices to configured bays
      bayNumbers: location.bays.map((b) => b.number).sort((a, b) => a - b),
      // NEW: used to show the “Buy Access (For Non-Members)” button
      passAccessUrl: location.passAccessUrl ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}


