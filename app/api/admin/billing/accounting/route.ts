/**
 * GET /api/admin/billing/accounting?locationSlug=&from=&to=[&format=csv]  → ledger rows / CSV   (billing.view)
 */
import { NextRequest, NextResponse } from "next/server";
import { buildLedger, ledgerToCsv } from "@/services/billing.service";
import { csvResponse, errorResponse, guardBilling, parseDate } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const g = await guardBilling({ locationSlug: sp.get("locationSlug"), locationId: sp.get("locationId") }, "billing.view");
  if (!g.ok) return g.response;
  try {
    const now = new Date();
    const start = parseDate(sp.get("from")) ?? new Date(now.getFullYear(), now.getMonth(), 1);
    const end = parseDate(sp.get("to")) ?? new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const rows = await buildLedger({ locationId: g.location.id, start, end });
    if (sp.get("format") === "csv") {
      return csvResponse(ledgerToCsv(rows), `ledger-${g.location.slug}-${start.toISOString().slice(0, 10)}-${end.toISOString().slice(0, 10)}.csv`);
    }
    return NextResponse.json({ rows });
  } catch (e) {
    return errorResponse(e);
  }
}
