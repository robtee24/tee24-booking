// GET /api/admin/sales/summary?locationSlug=&from=&to=
// Totals + breakdown by income category / GL code / payment kind, for the
// dashboard and the accounting export (billing worker).
import { NextResponse, type NextRequest } from "next/server";
import { salesSummary } from "@/services/pos.service";
import { guardPos, posErrorResponse } from "../_lib";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardPos(req);
  if (!g.ok) return g.response;
  const sp = req.nextUrl.searchParams;
  try {
    return NextResponse.json(await salesSummary(g.location, sp.get("from") ?? undefined, sp.get("to") ?? undefined));
  } catch (e) {
    return posErrorResponse(e);
  }
}
