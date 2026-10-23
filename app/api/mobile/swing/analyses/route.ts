// GET  /api/mobile/swing/analyses?limit=30 → { enabled, limits, analyses }
// POST /api/mobile/swing/analyses { handedness, view, club, title, notes, recordedAt }
//      → { analysis, upload: { url, field, fields, expiresAt, limits } }
//      The phone then multipart-POSTs the video straight to swinglab using `upload`.
import { createAnalysis, listAnalyses, type CreateSwingInput } from "@/services/mobile-swing.service";
import { ok, readJson, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("swing/analyses", async (req, auth) => {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 30);
  return ok(await listAnalyses(auth.memberId, Number.isFinite(limit) ? limit : 30));
});

export const POST = withMobileAuth("swing/analyses", async (req, auth) => {
  const body = await readJson<CreateSwingInput>(req);
  return ok(await createAnalysis(auth.memberId, body), { status: 201 });
});
