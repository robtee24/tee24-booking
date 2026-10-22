// POST /api/admin/sales/[id]/refund { locationSlug, lineItemIds?, reason? }  — full or per-line refund (billing.refund)
import { NextResponse, type NextRequest } from "next/server";
import { refundSale } from "@/services/pos.service";
import { guardPos, posErrorResponse, readJson } from "../../_lib";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = await readJson<{ locationSlug?: string; lineItemIds?: string[]; reason?: string | null }>(req);
  const g = await guardPos(req, { permission: "billing.refund", body });
  if (!g.ok) return g.response;
  try {
    const { id } = await ctx.params;
    const sale = await refundSale(g.location, id, { lineItemIds: Array.isArray(body.lineItemIds) ? body.lineItemIds.map(String) : undefined, reason: body.reason ?? null, mode: "refund" }, { id: g.admin.id });
    return NextResponse.json({ sale });
  } catch (e) {
    return posErrorResponse(e);
  }
}
