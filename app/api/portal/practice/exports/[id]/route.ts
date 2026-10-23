// DELETE /api/portal/practice/exports/:id
import { deleteExport } from "@/services/shot-export.service";
import { ok, withPortalMember } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withPortalMember<Ctx>("practice/exports/delete", async (_req, auth, ctx) => {
  const { id } = await ctx.params;
  return ok(await deleteExport(auth.memberId, id));
}, { write: true });
