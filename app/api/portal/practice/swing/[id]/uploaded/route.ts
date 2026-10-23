// POST /api/portal/practice/swing/:id/uploaded { jobId } — browser finished the swinglab upload
import { markUploaded } from "@/services/mobile-swing.service";
import { ok, readJson, withPortalMember } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPortalMember<Ctx>("swing/uploaded", async (req, auth, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson<{ jobId?: string }>(req);
  return ok(await markUploaded(auth.memberId, id, body.jobId));
}, { write: true });
