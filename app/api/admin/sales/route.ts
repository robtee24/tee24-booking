// GET  /api/admin/sales?locationSlug=&from=&to=&staffId=&paymentKind=&status=&q=[&format=csv]  — list sales
// POST /api/admin/sales  { locationSlug, ...CreateSaleRequest }                                    — complete a sale (billing.charge)
import { NextResponse, type NextRequest } from "next/server";
import { createSale, listSales, salesToCsv } from "@/services/pos.service";
import type { CreateSaleRequest, PaymentKind, SaleStatus } from "@/components/admin/sales/types";
import { csvResponse, guardPos, posErrorResponse, readJson } from "./_lib";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardPos(req);
  if (!g.ok) return g.response;
  const sp = req.nextUrl.searchParams;
  try {
    const { sales, staff } = await listSales(g.location, {
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      staffId: sp.get("staffId") ?? undefined,
      paymentKind: (sp.get("paymentKind") ?? "") as PaymentKind | "",
      status: (sp.get("status") ?? "") as SaleStatus | "",
      q: sp.get("q") ?? undefined,
    });
    if (sp.get("format") === "csv") return csvResponse(salesToCsv(sales, g.location.timezone), `sales-${g.location.slug}.csv`);
    return NextResponse.json({ sales, staff });
  } catch (e) {
    return posErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const body = await readJson<CreateSaleRequest & { locationSlug?: string }>(req);
  const g = await guardPos(req, { permission: "billing.charge", body });
  if (!g.ok) return g.response;
  try {
    const sale = await createSale(g.location, body, { id: g.admin.id });
    return NextResponse.json({ sale }, { status: 201 });
  } catch (e) {
    return posErrorResponse(e);
  }
}
