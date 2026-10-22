import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { createFamily, getFamilyDetail } from "@/services/family.service";
import { apiError, readJson, requireMemberApi } from "@/app/api/admin/members/_shared";
import { decorateFamily } from "./_shared";

export const dynamic = "force-dynamic";

/** GET /api/admin/family?memberId= — the member's family (if any) */
export async function GET(req: NextRequest) {
  const memberId = req.nextUrl.searchParams.get("memberId");
  if (!memberId) return NextResponse.json({ error: "memberId is required" }, { status: 400 });
  const g = await requireMemberApi(memberId);
  if (!g.ok) return g.response;
  const link = await getPrisma().familyMember.findUnique({ where: { memberId }, select: { familyAccountId: true } });
  if (!link) return NextResponse.json({ family: null });
  const family = await getFamilyDetail(link.familyAccountId);
  return NextResponse.json({ family: await decorateFamily(family) });
}

/** POST /api/admin/family { primaryMemberId, name? } — create a family with this member as primary (permission member.edit) */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const primaryMemberId = String(body.primaryMemberId ?? "");
  if (!primaryMemberId) return NextResponse.json({ error: "primaryMemberId is required" }, { status: 400 });
  const g = await requireMemberApi(primaryMemberId);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "member.edit", { locationId: g.member.locationId });
    const existing = await getPrisma().familyMember.findUnique({ where: { memberId: primaryMemberId } });
    if (existing) return NextResponse.json({ error: "This member already belongs to a family" }, { status: 409 });
    const name = String(body.name ?? "").trim() || `${g.member.lastName} family`;
    const fam = await createFamily({ name, primaryMemberId, actorId: g.admin.id });
    const family = await getFamilyDetail(fam.id);
    return NextResponse.json({ ok: true, family: await decorateFamily(family) });
  } catch (e) {
    return apiError(e);
  }
}
