// GET    /api/mobile/practice/sessions/:id → { session (with shots) }
// DELETE /api/mobile/practice/sessions/:id → { deleted }
import { deleteSession, getSession } from "@/services/mobile-practice.service";
import { ok, withMobileAuth } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withMobileAuth<Ctx>("practice/session", async (_req, auth, ctx) => {
  const { id } = await ctx.params;
  return ok(await getSession(auth.memberId, id));
});

export const DELETE = withMobileAuth<Ctx>("practice/session", async (_req, auth, ctx) => {
  const { id } = await ctx.params;
  return ok(await deleteSession(auth.memberId, id));
});
