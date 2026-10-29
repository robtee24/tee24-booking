// DELETE /api/mobile/swing/analyses/:id/media
// The phone has saved the clip and the rendered videos. Drop the server copies.
import { purgeAnalysisMedia } from "@/services/mobile-swing.service";
import { ok, withMobileAuth } from "../../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withMobileAuth<Ctx>("swing/purge-media", async (_req, auth, ctx) => {
  const { id } = await ctx.params;
  return ok(await purgeAnalysisMedia(auth.memberId, id));
});
