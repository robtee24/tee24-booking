// PATCH /api/admin/gift-cards/[id] { locationSlug, action: "adjust", deltaCents, reason } | { action: "void", reason? }  (billing.refund)
import { NextResponse, type NextRequest } from "next/server";
import { adjustGiftCard, voidGiftCard } from "@/services/pos.service";
import { guardPos, posErrorResponse, readJson } from "../../sales/_lib";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = await readJson<{ locationSlug?: string; action?: "adjust" | "void"; deltaCents?: number; reason?: string | null }>(req);
  const g = await guardPos(req, { permission: "billing.refund", body });
  if (!g.ok) return g.response;
  try {
    const { id } = await ctx.params;
    if (body.action === "void") return NextResponse.json({ giftCard: await voidGiftCard(g.location, id, body.reason ?? null, g.admin.id) });
    if (body.action === "adjust") return NextResponse.json({ giftCard: await adjustGiftCard(g.location, id, { deltaCents: Number(body.deltaCents), reason: String(body.reason ?? "") }, g.admin.id) });
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return posErrorResponse(e);
  }
}
