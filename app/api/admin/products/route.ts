// GET  /api/admin/products?locationSlug=&q=&categoryId=&active=all|active|archived&lowStock=1[&format=csv]
// POST /api/admin/products { locationSlug, ...ProductInput }   (billing.configure)
import { NextResponse, type NextRequest } from "next/server";
import { createProduct, listProducts, productsToCsv } from "@/services/pos.service";
import type { ProductInput } from "@/components/admin/sales/types";
import { csvResponse, guardPos, posErrorResponse, readJson } from "../sales/_lib";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardPos(req);
  if (!g.ok) return g.response;
  const sp = req.nextUrl.searchParams;
  try {
    const products = await listProducts(g.location, {
      q: sp.get("q") ?? undefined,
      categoryId: sp.get("categoryId") ?? undefined,
      active: (sp.get("active") as "all" | "active" | "archived" | null) ?? "active",
      lowStock: sp.get("lowStock") === "1",
    });
    if (sp.get("format") === "csv") return csvResponse(productsToCsv(products), `products-${g.location.slug}.csv`);
    return NextResponse.json({ products });
  } catch (e) {
    return posErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const body = await readJson<ProductInput & { locationSlug?: string }>(req);
  const g = await guardPos(req, { permission: "billing.configure", body });
  if (!g.ok) return g.response;
  try {
    const product = await createProduct(g.location, body, g.admin.id);
    return NextResponse.json({ product }, { status: 201 });
  } catch (e) {
    return posErrorResponse(e);
  }
}
