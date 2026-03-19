import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const locationSlug = req.nextUrl.searchParams.get("locationSlug");
    if (!locationSlug) {
      return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
    }

    const location = await getPrisma().location.findUnique({
      where: { slug: locationSlug },
      select: { id: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const members = await getPrisma().member.findMany({
      where: { locationId: location.id },
      select: { email: true, phone: true, status: true, firstName: true, lastName: true, membershipType: true },
    });

    const byEmail: Record<string, { status: string; membershipType: string | null; firstName: string; lastName: string }> = {};
    const byPhone: Record<string, { status: string; membershipType: string | null; firstName: string; lastName: string }> = {};
    for (const m of members) {
      if (m.email) {
        byEmail[m.email.toLowerCase()] = { status: m.status, membershipType: m.membershipType, firstName: m.firstName, lastName: m.lastName };
      }
      if (m.phone) {
        byPhone[m.phone] = { status: m.status, membershipType: m.membershipType, firstName: m.firstName, lastName: m.lastName };
      }
    }

    return NextResponse.json({ byEmail, byPhone });
  } catch (e: any) {
    console.error("[Member lookup] Error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
