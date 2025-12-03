// app/api/location-info/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getPublicLocationInfo } from "@/services/location.service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const slug = req.nextUrl.searchParams.get("locationSlug")?.trim();

    if (!slug) {
      return new NextResponse("locationSlug is required", { status: 400 });
    }

    const location = await getPublicLocationInfo(slug);

    return NextResponse.json(location);
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 500;
    return new NextResponse(err.message || "Server error", { status });
  }
}