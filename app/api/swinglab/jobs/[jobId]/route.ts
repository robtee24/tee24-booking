// Analyzer → backend callbacks for a running swing job (hosted analyzer).
//
//   GET  /api/swinglab/jobs/:jobId  → { pro_id }   the member's current pro
//        choice ("" = best match); asked right before the side-by-side is cut
//   POST /api/swinglab/jobs/:jobId  { event: "detected_view", detected_view }
//
// Authenticated with the shared SWINGLAB_API_KEY in `X-Api-Key`.
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { swinglabConfig } from "@/lib/swinglab";
import { currentProChoice, recordDetectedView } from "@/services/mobile-swing.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ jobId: string }> };

function authorized(req: NextRequest) {
  const { apiKey } = swinglabConfig();
  const got = req.headers.get("x-api-key") ?? "";
  if (!apiKey || got.length !== apiKey.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(apiKey));
}

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { jobId } = await ctx.params;
  const choice = await currentProChoice(jobId);
  if (!choice) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  return NextResponse.json(choice);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { jobId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { event?: string; detected_view?: string | null };
  if (body.event === "detected_view") await recordDetectedView(jobId, body.detected_view);
  return NextResponse.json({ ok: true });
}
