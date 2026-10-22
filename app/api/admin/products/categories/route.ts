// GET  /api/admin/products/categories?locationSlug=
// POST /api/admin/products/categories { locationSlug, name, sortOrder? }  (billing.configure)
import { NextResponse, type NextRequest } from "next/server";
import { createCategory, listCategories } from "@/services/pos.service";
import { guardPos, posErrorResponse, readJson } from "../../sales/_lib";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardPos(req);
  if (!g.ok) return g.response;
  try {
    return NextResponse.json({ categories: await listCategories(g.location) });
  } catch (e) {
    return posErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const body = await readJson<{ locationSlug?: string; name?: string; sortOrder?: number }>(req);
  const g = await guardPos(req, { permission: "billing.configure", body });
  if (!g.ok) return g.response;
  try {
    const category = await createCategory(g.location, { name: String(body.name ?? ""), sortOrder: body.sortOrder }, g.admin.id);
    return NextResponse.json({ category }, { status: 201 });
  } catch (e) {
    return posErrorResponse(e);
  }
}
