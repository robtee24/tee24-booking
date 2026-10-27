import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi, apiError, readJson } from "@/app/api/admin/members/_shared";
import { getPrisma } from "@/lib/db";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const FIELD_TYPES = new Set(["TEXT", "NUMBER", "DATE", "SELECT", "MULTI_SELECT", "BOOLEAN"]);

async function loadField(locationSlug: string, id: string) {
  const locGuard = await requireLocationApi({ locationSlug });
  if (!locGuard.ok) return locGuard;
  const actor = await getActorContext();
  if (!actor) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  assertCan(actor, "member.edit", { locationId: locGuard.location.id });
  const loc = await getPrisma().location.findUnique({ where: { id: locGuard.location.id }, select: { organizationId: true } });
  const field = await getPrisma().customFieldDefinition.findFirst({
    where: { id, OR: [{ organizationId: loc?.organizationId ?? null }, { organizationId: null }] },
  });
  if (!field) return { ok: false as const, response: NextResponse.json({ error: "Field not found" }, { status: 404 }) };
  return { ok: true as const, field };
}

/** PATCH /api/admin/custom-fields/[id] { locationSlug, name?, type?, options?, required?, showOnSignup?, showOnProfile?, adminOnly? } */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  try {
    const locationSlug = req.nextUrl.searchParams.get("locationSlug") ?? String(body.locationSlug ?? "");
    if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
    const g = await loadField(locationSlug, id);
    if (!g.ok) return g.response;
    const type = body.type != null ? String(body.type).toUpperCase() : undefined;
    if (type && !FIELD_TYPES.has(type)) return NextResponse.json({ error: "Invalid field type" }, { status: 400 });
    const options = Array.isArray(body.options) ? body.options.map(String).map((s) => s.trim()).filter(Boolean) : undefined;
    const field = await getPrisma().customFieldDefinition.update({
      where: { id },
      data: {
        ...(body.name != null ? { name: String(body.name).trim() || g.field.name } : {}),
        ...(type ? { type } : {}),
        ...(options ? { options } : {}),
        ...(body.required != null ? { required: body.required === true } : {}),
        ...(body.showOnSignup != null ? { showOnSignup: body.showOnSignup === true } : {}),
        ...(body.showOnProfile != null ? { showOnProfile: body.showOnProfile === true } : {}),
        ...(body.adminOnly != null ? { adminOnly: body.adminOnly === true } : {}),
      },
    });
    return NextResponse.json({ ok: true, field });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/admin/custom-fields/[id]?locationSlug= — drops the definition and stored values */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const locationSlug = req.nextUrl.searchParams.get("locationSlug");
    if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
    const g = await loadField(locationSlug, id);
    if (!g.ok) return g.response;
    await getPrisma().customFieldDefinition.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
