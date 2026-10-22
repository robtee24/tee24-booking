// POST /api/admin/products/import { locationSlug, rows: [{ name, sku, price, category, inventory }] }  (billing.configure)
import { NextResponse, type NextRequest } from "next/server";
import { importProducts, type ProductImportRow } from "@/services/pos.service";
import { guardPos, posErrorResponse, readJson } from "../../sales/_lib";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await readJson<{ locationSlug?: string; rows?: ProductImportRow[] }>(req);
  const g = await guardPos(req, { permission: "billing.configure", body });
  if (!g.ok) return g.response;
  try {
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 2000) : [];
    if (!rows.length) return NextResponse.json({ error: "No rows to import" }, { status: 400 });
    return NextResponse.json(await importProducts(g.location, rows, g.admin.id));
  } catch (e) {
    return posErrorResponse(e);
  }
}
