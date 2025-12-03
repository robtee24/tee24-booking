// app/api/availability/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAvailability } from "@/services/availability.service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;

    const locationSlug = searchParams.get("locationSlug");
    const date = searchParams.get("date");
    const kindParam = searchParams.get("kind")?.toUpperCase();
    const handParam = searchParams.get("hand")?.toUpperCase();

    if (!locationSlug || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new NextResponse("Invalid locationSlug or date", { status: 400 });
    }

    if (!kindParam || !["SINGLE", "GROUP"].includes(kindParam)) {
      return new NextResponse("kind must be SINGLE or GROUP", { status: 400 });
    }

    if (kindParam === "SINGLE" && handParam !== "RH" && handParam !== "LH") {
      return new NextResponse("hand must be RH or LH when kind=SINGLE", { status: 400 });
    }

    const result = await getAvailability({
      locationSlug,
      date,
      kind: kindParam as "SINGLE" | "GROUP",
      hand: handParam as "RH" | "LH" | undefined,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Availability API error:", err);

    const status = err.message.includes("not found")
      ? 404
      : err.message.includes("Invalid") || err.message.includes("must be")
      ? 400
      : 500;

    return new NextResponse(err.message || "Server error", { status });
  }
}