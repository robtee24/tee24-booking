// GET /api/admin/sales/context?locationSlug=  — everything the New Sale screen needs in one call
import { NextResponse, type NextRequest } from "next/server";
import { getPosContext } from "@/services/pos.service";
import { guardPos, posErrorResponse } from "../_lib";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardPos(req);
  if (!g.ok) return g.response;
  try {
    return NextResponse.json(await getPosContext(g.location));
  } catch (e) {
    return posErrorResponse(e);
  }
}
