import { NextRequest, NextResponse } from "next/server";
import { assertCan } from "@/lib/permissions";
import { convertVisitorToMember } from "@/services/member.service";
import { apiError, requireMemberApi } from "../../_shared";

export const dynamic = "force-dynamic";

/** POST /api/admin/members/[id]/convert — visitor → member (permission member.edit) */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "member.edit", { locationId: g.member.locationId });
    const member = await convertVisitorToMember(id, g.admin.id);
    return NextResponse.json({ ok: true, member });
  } catch (e) {
    return apiError(e);
  }
}
