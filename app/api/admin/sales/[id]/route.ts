// GET /api/admin/sales/[id]?locationSlug=  — sale detail
import { NextResponse, type NextRequest } from "next/server";
import { getSale } from "@/services/pos.service";
import { guardPos, posErrorResponse } from "../_lib";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardPos(req);
  if (!g.ok) return g.response;
  try {
    const { id } = await ctx.params;
    return NextResponse.json({ sale: await getSale(g.location, id) });
  } catch (e) {
    return posErrorResponse(e);
  }
}
