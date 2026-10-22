import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { addMemberTag, removeMemberTag } from "@/services/member.service";
import { apiError, readJson, requireMemberApi } from "../../_shared";

export const dynamic = "force-dynamic";

/** POST /api/admin/members/[id]/tags { tagId } | { name, color? } — permission member.edit */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "member.edit", { locationId: g.member.locationId });
    const body = await readJson(req);
    let tagId = body.tagId ? String(body.tagId) : null;
    if (!tagId && body.name) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
      const existing = await getPrisma().tag.findFirst({ where: { organizationId: g.location.organizationId, name: { equals: name, mode: "insensitive" } } });
      const tag = existing ?? (await getPrisma().tag.create({ data: { organizationId: g.location.organizationId, name, color: body.color || "#16a34a" } }));
      tagId = tag.id;
    }
    if (!tagId) return NextResponse.json({ error: "tagId or name required" }, { status: 400 });
    await addMemberTag(id, tagId, g.admin.id);
    const tags = await getPrisma().memberTag.findMany({ where: { memberId: id }, include: { tag: true } });
    return NextResponse.json({ ok: true, tags: tags.map((t) => t.tag) });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/admin/members/[id]/tags?tagId= — permission member.edit */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "member.edit", { locationId: g.member.locationId });
    const tagId = req.nextUrl.searchParams.get("tagId") || (await readJson(req)).tagId;
    if (!tagId) return NextResponse.json({ error: "tagId required" }, { status: 400 });
    await removeMemberTag(id, String(tagId), g.admin.id);
    const tags = await getPrisma().memberTag.findMany({ where: { memberId: id }, include: { tag: true } });
    return NextResponse.json({ ok: true, tags: tags.map((t) => t.tag) });
  } catch (e) {
    return apiError(e);
  }
}
