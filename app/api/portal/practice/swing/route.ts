// GET /api/portal/practice/swing?limit= → { enabled, limits, analyses }
// POST { handedness, view, club, title, notes, recordedAt } → { analysis, upload }
//   The browser then multipart-POSTs the clip straight to swinglab using `upload`
//   (same ticket flow as the phone), then calls POST /swing/:id/uploaded { jobId }.
import { createAnalysis, listAnalyses, type CreateSwingInput } from "@/services/mobile-swing.service";
import { ok, readJson, withPortalMember } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPortalMember("swing/analyses", async (req, auth) => {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 30);
  return ok(await listAnalyses(auth.memberId, Number.isFinite(limit) ? limit : 30));
});

export const POST = withPortalMember("swing/analyses", async (req, auth) => {
  const body = await readJson<CreateSwingInput>(req);
  return ok(await createAnalysis(auth.memberId, body), { status: 201 });
}, { write: true });
