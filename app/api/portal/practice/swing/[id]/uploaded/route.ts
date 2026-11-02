// POST /api/portal/practice/swing/:id/uploaded { jobId } — browser finished the swinglab upload
import { markUploaded } from "@/services/mobile-swing.service";
import { ok, readJson, withPortalMember } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Blob flow: the analysis runs inside `after()`, so this function must live as long as the analyzer call.
export const maxDuration = 800;

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPortalMember<Ctx>("swing/uploaded", async (req, auth, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson<{ jobId?: string }>(req);
  return ok(await markUploaded(auth.memberId, id, body.jobId));
}, { write: true });
