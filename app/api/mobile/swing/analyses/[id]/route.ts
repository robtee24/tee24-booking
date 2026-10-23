// GET    /api/mobile/swing/analyses/:id → { analysis } (refreshes job state while processing)
// DELETE /api/mobile/swing/analyses/:id → { deleted }
import { deleteAnalysis, getAnalysis } from "@/services/mobile-swing.service";
import { ok, withMobileAuth } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withMobileAuth<Ctx>("swing/analysis", async (_req, auth, ctx) => {
  const { id } = await ctx.params;
  return ok(await getAnalysis(auth.memberId, id));
});

export const DELETE = withMobileAuth<Ctx>("swing/analysis", async (_req, auth, ctx) => {
  const { id } = await ctx.params;
  return ok(await deleteAnalysis(auth.memberId, id));
});
