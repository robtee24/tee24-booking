// app/api/location-bays/route.ts
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("locationSlug");
    if (!slug) {
      return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
    }

    const loc = await getPrisma().location.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!loc) return NextResponse.json({ error: "Location not found" }, { status: 404 });

    const bays = await getPrisma().bay.findMany({
      where: { locationId: loc.id },
      orderBy: { number: "asc" },
      select: {
        number: true,
        kind: true,         // 'SINGLE' | 'GROUP'
        handedness: true,   // 'RH' | 'LH' | null
        capacity: true,     // number
      },
    });

    return NextResponse.json({ bays });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
