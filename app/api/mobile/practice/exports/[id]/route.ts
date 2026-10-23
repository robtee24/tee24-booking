// DELETE /api/mobile/practice/exports/:id → discard a pending/failed kiosk export
import { deleteExport } from "@/services/shot-export.service";
import { ok, withMobileAuth } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withMobileAuth<Ctx>("practice/exports/delete", async (_req, auth, ctx) => {
  const { id } = await ctx.params;
  return ok(await deleteExport(auth.memberId, id));
});
