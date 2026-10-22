import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi } from "@/app/api/admin/members/_shared";
import { getPrisma } from "@/lib/db";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { apiError, readJson } from "@/app/api/admin/members/_shared";

export const dynamic = "force-dynamic";

/** GET /api/admin/tags?locationSlug= — tags visible to this location's org (with member counts) */
export async function GET(req: NextRequest) {
  const locationSlug = req.nextUrl.searchParams.get("locationSlug");
  if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug });
  if (!guard.ok) return guard.response;
  const loc = await getPrisma().location.findUnique({ where: { id: guard.location.id }, select: { organizationId: true } });
  const tags = await getPrisma().tag.findMany({
    where: { OR: [{ organizationId: loc?.organizationId ?? null }, { organizationId: null }] },
    orderBy: { name: "asc" },
    include: { _count: { select: { members: true } } },
  });
  return NextResponse.json({ tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color, memberCount: t._count.members })) });
}

/** POST /api/admin/tags { locationSlug, name, color? } — permission member.edit */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body.locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug: body.locationSlug });
  if (!guard.ok) return guard.response;
  try {
    const actor = await getActorContext();
    assertCan(actor, "member.edit", { locationId: guard.location.id });
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const loc = await getPrisma().location.findUnique({ where: { id: guard.location.id }, select: { organizationId: true } });
    const existing = await getPrisma().tag.findFirst({ where: { organizationId: loc?.organizationId ?? null, name: { equals: name, mode: "insensitive" } } });
    const tag = existing ?? (await getPrisma().tag.create({ data: { organizationId: loc?.organizationId ?? null, name, color: body.color ? String(body.color) : "#16a34a" } }));
    return NextResponse.json({ ok: true, tag, created: !existing });
  } catch (e) {
    return apiError(e);
  }
}
