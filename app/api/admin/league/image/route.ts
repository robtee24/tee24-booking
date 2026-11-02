// GET /api/admin/league/image?id= — scorecard screenshot / photo bytes for the League Manager
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { getScorecardImage } from "@/services/league.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const img = await getScorecardImage(id);
  if (!img) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(img.data), { headers: { "content-type": img.mimeType, "cache-control": "private, max-age=86400" } });
}
