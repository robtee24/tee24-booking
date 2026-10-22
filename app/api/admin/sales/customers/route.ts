// GET /api/admin/sales/customers?locationSlug=&q=  — member search with credit balance for the POS
import { NextResponse, type NextRequest } from "next/server";
import { searchCustomers } from "@/services/pos.service";
import { guardPos, posErrorResponse } from "../_lib";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardPos(req);
  if (!g.ok) return g.response;
  try {
    return NextResponse.json({ customers: await searchCustomers(g.location, req.nextUrl.searchParams.get("q") ?? "") });
  } catch (e) {
    return posErrorResponse(e);
  }
}
