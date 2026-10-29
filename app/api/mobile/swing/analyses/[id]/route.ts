// GET    /api/mobile/swing/analyses/:id → { analysis } (refreshes job state while processing)
// POST   /api/mobile/swing/analyses/:id { proId } → re-compare against a different pro
// DELETE /api/mobile/swing/analyses/:id → { deleted }
import { deleteAnalysis, getAnalysis, recompareAnalysis } from "@/services/mobile-swing.service";
import { ok, readJson, withMobileAuth } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withMobileAuth<Ctx>("swing/analysis", async (_req, auth, ctx) => {
  const { id } = await ctx.params;
  return ok(await getAnalysis(auth.memberId, id));
});

export const POST = withMobileAuth<Ctx>("swing/recompare", async (req, auth, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson<{ proId?: string }>(req);
  return ok(await recompareAnalysis(auth.memberId, id, body.proId ?? ""));
});

export const DELETE = withMobileAuth<Ctx>("swing/analysis", async (_req, auth, ctx) => {
  const { id } = await ctx.params;
  return ok(await deleteAnalysis(auth.memberId, id));
});
