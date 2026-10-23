// GET / DELETE /api/portal/practice/sessions/:id
import { deleteSession, getSession } from "@/services/mobile-practice.service";
import { ok, withPortalMember } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPortalMember<Ctx>("practice/session", async (_req, auth, ctx) => {
  const { id } = await ctx.params;
  return ok(await getSession(auth.memberId, id));
});

export const DELETE = withPortalMember<Ctx>("practice/session", async (_req, auth, ctx) => {
  const { id } = await ctx.params;
  return ok(await deleteSession(auth.memberId, id));
}, { write: true });
