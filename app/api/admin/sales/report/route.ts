// GET /api/admin/sales/report?locationSlug=&from=&to=[&format=csv]
import { NextResponse, type NextRequest } from "next/server";
import { reportToCsv, salesReport } from "@/services/pos.service";
import { csvResponse, guardPos, posErrorResponse } from "../_lib";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardPos(req);
  if (!g.ok) return g.response;
  const sp = req.nextUrl.searchParams;
  try {
    const report = await salesReport(g.location, sp.get("from") ?? undefined, sp.get("to") ?? undefined);
    if (sp.get("format") === "csv") return csvResponse(reportToCsv(report), `sales-report-${g.location.slug}.csv`);
    return NextResponse.json(report);
  } catch (e) {
    return posErrorResponse(e);
  }
}
