// GET / DELETE /api/portal/practice/swing/:id
import { deleteAnalysis, getAnalysis } from "@/services/mobile-swing.service";
import { ok, withPortalMember } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPortalMember<Ctx>("swing/analysis", async (_req, auth, ctx) => {
  const { id } = await ctx.params;
  return ok(await getAnalysis(auth.memberId, id));
});

export const DELETE = withPortalMember<Ctx>("swing/analysis", async (_req, auth, ctx) => {
  const { id } = await ctx.params;
  return ok(await deleteAnalysis(auth.memberId, id));
}, { write: true });
