// GET    /api/admin/products/[id]?locationSlug=
// PATCH  /api/admin/products/[id] { locationSlug, ...Partial<ProductInput> }  (billing.configure)
// DELETE /api/admin/products/[id]?locationSlug=                                 (billing.configure) — archives
import { NextResponse, type NextRequest } from "next/server";
import { archiveProduct, getProduct, updateProduct } from "@/services/pos.service";
import type { ProductInput } from "@/components/admin/sales/types";
import { guardPos, posErrorResponse, readJson } from "../../sales/_lib";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await guardPos(req);
  if (!g.ok) return g.response;
  try {
    const { id } = await ctx.params;
    return NextResponse.json({ product: await getProduct(g.location, id) });
  } catch (e) {
    return posErrorResponse(e);
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const body = await readJson<Partial<ProductInput> & { locationSlug?: string }>(req);
  const g = await guardPos(req, { permission: "billing.configure", body });
  if (!g.ok) return g.response;
  try {
    const { id } = await ctx.params;
    const { locationSlug: _slug, ...input } = body;
    void _slug;
    return NextResponse.json({ product: await updateProduct(g.location, id, input, g.admin.id) });
  } catch (e) {
    return posErrorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await guardPos(req, { permission: "billing.configure" });
  if (!g.ok) return g.response;
  try {
    const { id } = await ctx.params;
    return NextResponse.json({ product: await archiveProduct(g.location, id, g.admin.id) });
  } catch (e) {
    return posErrorResponse(e);
  }
}
