// POST /api/admin/sales/[id]/receipt { locationSlug, to? }  — resend receipt email
import { NextResponse, type NextRequest } from "next/server";
import { resendReceipt } from "@/services/pos.service";
import { guardPos, posErrorResponse, readJson } from "../../_lib";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = await readJson<{ locationSlug?: string; to?: string | null }>(req);
  const g = await guardPos(req, { body });
  if (!g.ok) return g.response;
  try {
    const { id } = await ctx.params;
    return NextResponse.json(await resendReceipt(g.location, id, body.to ?? null));
  } catch (e) {
    return posErrorResponse(e);
  }
}
