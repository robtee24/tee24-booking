import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi } from "@/app/api/admin/members/_shared";
import { getPrisma } from "@/lib/db";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { apiError, readJson } from "@/app/api/admin/members/_shared";

export const dynamic = "force-dynamic";

async function loadOwnedTag(locationSlug: string, id: string) {
  const locGuard = await requireLocationApi({ locationSlug });
  if (!locGuard.ok) return locGuard;
  const actor = await getActorContext();
  if (!actor) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  assertCan(actor, "member.edit", { locationId: locGuard.location.id });
  const loc = await getPrisma().location.findUnique({ where: { id: locGuard.location.id }, select: { organizationId: true } });
  const tag = await getPrisma().tag.findFirst({
    where: { id, OR: [{ organizationId: loc?.organizationId ?? null }, { organizationId: null }] },
  });
  if (!tag) return { ok: false as const, response: NextResponse.json({ error: "Tag not found" }, { status: 404 }) };
  return { ok: true as const, tag };
}

/** PATCH /api/admin/tags/[id] { locationSlug, name?, color? } */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  try {
    const locationSlug = req.nextUrl.searchParams.get("locationSlug") ?? String(body.locationSlug ?? "");
    if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
    const g = await loadOwnedTag(locationSlug, id);
    if (!g.ok) return g.response;
    const name = body.name != null ? String(body.name).trim() : undefined;
    if (name === "") return NextResponse.json({ error: "name is required" }, { status: 400 });
    const tag = await getPrisma().tag.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(body.color != null ? { color: String(body.color) } : {}),
      },
    });
    return NextResponse.json({ ok: true, tag });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/admin/tags/[id]?locationSlug= — removes the tag from every member */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const locationSlug = req.nextUrl.searchParams.get("locationSlug");
    if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
    const g = await loadOwnedTag(locationSlug, id);
    if (!g.ok) return g.response;
    await getPrisma().tag.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
