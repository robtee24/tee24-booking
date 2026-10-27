import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi, apiError, readJson } from "@/app/api/admin/members/_shared";
import { getPrisma } from "@/lib/db";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { listCustomFieldDefinitions } from "@/services/member.service";

export const dynamic = "force-dynamic";

const FIELD_TYPES = new Set(["TEXT", "NUMBER", "DATE", "SELECT", "MULTI_SELECT", "BOOLEAN"]);

function slugKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "field";
}

/** GET /api/admin/custom-fields?locationSlug=&memberId? — definitions (+ current values when memberId given) */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const locationSlug = sp.get("locationSlug");
  if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug });
  if (!guard.ok) return guard.response;
  const loc = await getPrisma().location.findUnique({ where: { id: guard.location.id }, select: { organizationId: true } });
  const fields = await listCustomFieldDefinitions(loc?.organizationId ?? null);
  const memberId = sp.get("memberId");
  let values: Record<string, unknown> = {};
  if (memberId) {
    const rows = await getPrisma().customFieldValue.findMany({ where: { memberId, fieldId: { in: fields.map((f) => f.id) } } });
    values = Object.fromEntries(rows.map((r) => [r.fieldId, r.valueText ?? r.valueNumber ?? r.valueDate ?? r.valueJson ?? null]));
  }
  return NextResponse.json({ fields, values });
}

/** POST /api/admin/custom-fields { locationSlug, name, type, options?, required?, showOnSignup?, showOnProfile?, adminOnly? } */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body.locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug: String(body.locationSlug) });
  if (!guard.ok) return guard.response;
  try {
    const actor = await getActorContext();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertCan(actor, "member.edit", { locationId: guard.location.id });
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const type = String(body.type ?? "TEXT").toUpperCase();
    if (!FIELD_TYPES.has(type)) return NextResponse.json({ error: "Invalid field type" }, { status: 400 });
    const loc = await getPrisma().location.findUnique({ where: { id: guard.location.id }, select: { organizationId: true } });
    const organizationId = loc?.organizationId ?? null;
    let key = String(body.key ?? slugKey(name));
    const clash = await getPrisma().customFieldDefinition.findFirst({ where: { organizationId, key } });
    if (clash) key = `${key}_${Date.now().toString(36)}`;
    const options = Array.isArray(body.options) ? body.options.map(String).map((s) => s.trim()).filter(Boolean) : [];
    if ((type === "SELECT" || type === "MULTI_SELECT") && options.length === 0) {
      return NextResponse.json({ error: "Add at least one option for a select field" }, { status: 400 });
    }
    const last = await getPrisma().customFieldDefinition.findFirst({ where: { organizationId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const field = await getPrisma().customFieldDefinition.create({
      data: {
        organizationId,
        name,
        key,
        type,
        options: options.length ? options : undefined,
        required: body.required === true,
        showOnSignup: body.showOnSignup === true,
        showOnProfile: body.showOnProfile !== false,
        adminOnly: body.adminOnly === true,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
    return NextResponse.json({ ok: true, field });
  } catch (e) {
    return apiError(e);
  }
}
