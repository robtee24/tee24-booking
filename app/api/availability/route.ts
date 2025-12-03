// app/api/availability/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAvailability } from "@/services/availability.service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;

    const locationSlug = searchParams.get("locationSlug");
    const date = searchParams.get("date");

    const includeSlots = searchParams.get("includeSlots") === "true";
    const includeFreeBays = searchParams.get("includeFreeBays") === "true";

    const kindParam = searchParams.get("kind")?.toUpperCase();
    const handParam = searchParams.get("hand")?.toUpperCase();

    // ─────── Validation ───────
    if (!locationSlug || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new NextResponse("Invalid locationSlug or date", { status: 400 });
    }

    if (!kindParam || !["SINGLE", "GROUP"].includes(kindParam)) {
      return new NextResponse("kind must be SINGLE or GROUP", { status: 400 });
    }

    if (kindParam === "SINGLE" && handParam !== "RH" && handParam !== "LH" && handParam !== null) {
      return new NextResponse("hand must be RH or LH when kind=SINGLE", { status: 400 });
    }

    // ─────── Call service with new options ───────
    const result = await getAvailability({
      locationSlug,
      date,
      kind: kindParam as "SINGLE" | "GROUP",
      hand: (handParam as "RH" | "LH" | undefined) ?? undefined,
      includeSlots,
      includeFreeBays,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Availability API error:", err);
    const status =
      err.message.includes("not found") || err.message.includes("Location")
        ? 404
        : err.message.includes("Invalid") || err.message.includes("must be")
        ? 400
        : 500;

    return new NextResponse(err.message || "Server error", { status });
  }
}