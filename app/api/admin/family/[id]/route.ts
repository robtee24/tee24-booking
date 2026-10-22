import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { requireLocationAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { addFamilyMember, changePrimary, getFamilyDetail, removeFamilyMember, type FamilyRole } from "@/services/family.service";
import { apiError, readJson } from "@/app/api/admin/members/_shared";
import { decorateFamily } from "../_shared";

export const dynamic = "force-dynamic";

const ROLES: FamilyRole[] = ["PRIMARY", "SPOUSE", "CHILD", "PARENT", "GUARDIAN", "OTHER"];

async function guardFamily(familyId: string) {
  const family = await getFamilyDetail(familyId);
  if (!family) return { ok: false as const, response: NextResponse.json({ error: "Family not found" }, { status: 404 }) };
  const locationId = family.members[0]?.member.locationId;
  if (!locationId) return { ok: false as const, response: NextResponse.json({ error: "Family has no members" }, { status: 400 }) };
  const guard = await requireLocationAdminApi({ locationId });
  if (!guard.ok) return { ok: false as const, response: guard.response };
  const actor = await getActorContext();
  if (!actor) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { ok: true as const, family, locationId, admin: guard.admin, actor };
}

/** GET /api/admin/family/[id] */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardFamily(id);
  if (!g.ok) return g.response;
  return NextResponse.json({ family: await decorateFamily(g.family) });
}

/** POST /api/admin/family/[id] { memberId, role } — add an existing member (permission member.edit) */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardFamily(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "member.edit", { locationId: g.locationId });
    const body = await readJson(req);
    const memberId = String(body.memberId ?? "");
    if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });
    const target = await getPrisma().member.findUnique({ where: { id: memberId }, select: { locationId: true, status: true } });
    if (!target || target.locationId !== g.locationId) return NextResponse.json({ error: "Member not found at this location" }, { status: 404 });
    const already = await getPrisma().familyMember.findUnique({ where: { memberId } });
    if (already) return NextResponse.json({ error: already.familyAccountId === id ? "Already in this family" : "Member belongs to another family" }, { status: 409 });
    const role: FamilyRole = ROLES.includes(body.role) && body.role !== "PRIMARY" ? body.role : "OTHER";
    await addFamilyMember({ familyId: id, memberId, role, actorId: g.admin.id });
    return NextResponse.json({ ok: true, family: await decorateFamily(await getFamilyDetail(id)) });
  } catch (e) {
    return apiError(e);
  }
}

/** PATCH /api/admin/family/[id] { primaryMemberId? , name?, memberId?+role? } — change primary / rename / change role */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardFamily(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "member.edit", { locationId: g.locationId });
    const body = await readJson(req);
    if (body.primaryMemberId) {
      const pid = String(body.primaryMemberId);
      if (!g.family.members.some((m) => m.memberId === pid)) return NextResponse.json({ error: "Member is not in this family" }, { status: 400 });
      await changePrimary({ familyId: id, newPrimaryMemberId: pid, actorId: g.admin.id });
      await getPrisma().familyMember.updateMany({ where: { familyAccountId: id, memberId: pid }, data: { isPrimary: true, role: "PRIMARY" } });
    }
    if (body.name) {
      await getPrisma().familyAccount.update({ where: { id }, data: { name: String(body.name).trim() } });
    }
    if (body.memberId && body.role && ROLES.includes(body.role) && body.role !== "PRIMARY") {
      await getPrisma().familyMember.updateMany({ where: { familyAccountId: id, memberId: String(body.memberId), isPrimary: false }, data: { role: body.role } });
    }
    void audit({ actorId: g.admin.id, actorRole: g.admin.role, action: "member.update", entityType: "FamilyAccount", entityId: id, metadata: { event: "family.updated", patch: body } });
    return NextResponse.json({ ok: true, family: await decorateFamily(await getFamilyDetail(id)) });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/admin/family/[id]?memberId= — remove a member; with no memberId, dissolve the family */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardFamily(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "member.edit", { locationId: g.locationId });
    const memberId = req.nextUrl.searchParams.get("memberId");
    const prisma = getPrisma();
    if (memberId) {
      await removeFamilyMember({ familyId: id, memberId, actorId: g.admin.id });
      return NextResponse.json({ ok: true, family: await decorateFamily(await getFamilyDetail(id)) });
    }
    await prisma.member.updateMany({ where: { familyAccountId: id }, data: { familyAccountId: null } });
    await prisma.familyAccount.delete({ where: { id } });
    void audit({ actorId: g.admin.id, actorRole: g.admin.role, action: "member.update", entityType: "FamilyAccount", entityId: id, metadata: { event: "family.dissolved" } });
    return NextResponse.json({ ok: true, family: null });
  } catch (e) {
    return apiError(e);
  }
}
