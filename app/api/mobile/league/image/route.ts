// GET /api/mobile/league/image?id= — scorecard image bytes (member session required)
import { NextResponse } from "next/server";
import { getScorecardImage } from "@/services/league.service";
import { fail, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("league/image", async (req) => {
  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id) return fail("id required", 400, "BAD_REQUEST");
  const img = await getScorecardImage(id);
  if (!img) return fail("Not found", 404, "NOT_FOUND");
  return new NextResponse(new Uint8Array(img.data), { headers: { "content-type": img.mimeType, "cache-control": "private, max-age=86400", "content-length": String(img.sizeBytes) } });
});
