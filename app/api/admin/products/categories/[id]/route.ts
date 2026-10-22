// PATCH  /api/admin/products/categories/[id] { locationSlug, name?, sortOrder? }  (billing.configure)
// DELETE /api/admin/products/categories/[id]?locationSlug=                       (billing.configure)
import { NextResponse, type NextRequest } from "next/server";
import { deleteCategory, updateCategory } from "@/services/pos.service";
import { guardPos, posErrorResponse, readJson } from "../../../sales/_lib";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const body = await readJson<{ locationSlug?: string; name?: string; sortOrder?: number }>(req);
  const g = await guardPos(req, { permission: "billing.configure", body });
  if (!g.ok) return g.response;
  try {
    const { id } = await ctx.params;
    return NextResponse.json({ category: await updateCategory(g.location, id, { name: body.name, sortOrder: body.sortOrder }, g.admin.id) });
  } catch (e) {
    return posErrorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await guardPos(req, { permission: "billing.configure" });
  if (!g.ok) return g.response;
  try {
    const { id } = await ctx.params;
    await deleteCategory(g.location, id, g.admin.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return posErrorResponse(e);
  }
}
