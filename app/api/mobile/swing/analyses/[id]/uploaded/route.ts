// POST /api/mobile/swing/analyses/:id/uploaded { jobId, detectedView? } → { analysis }
// Called by the phone right after swinglab accepts the clip (202 { job_id }).
import { markUploaded } from "@/services/mobile-swing.service";
import { ok, readJson, withMobileAuth } from "../../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withMobileAuth<Ctx>("swing/uploaded", async (req, auth, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson<{ jobId?: string; detectedView?: string | null }>(req);
  return ok(await markUploaded(auth.memberId, id, body.jobId, body.detectedView));
});
