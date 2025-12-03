// app/api/bay/day/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getBaySchedule } from "@/services/bay.service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const bayId = searchParams.get("id")?.trim();
    const date = searchParams.get("d") || undefined;

    if (!bayId) {
      return new NextResponse("Missing bay id", { status: 400 });
    }

    const schedule = await getBaySchedule(bayId, date);

    return NextResponse.json(schedule);
  } catch (err: any) {
    console.error("GET /api/bay/day error:", err);
    const status = err.message.includes("not found") ? 404 : 500;
    return new NextResponse(err.message || "Server error", { status });
  }
}