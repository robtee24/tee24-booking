import { NextRequest, NextResponse } from "next/server";
import { assertCan } from "@/lib/permissions";
import { setCheckinCode } from "@/services/member.service";
import { apiError, readJson, requireMemberApi } from "../../_shared";

export const dynamic = "force-dynamic";

/** POST /api/admin/members/[id]/checkin-code { code?: "1234" } — omit code to regenerate. Permission member.edit */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "member.edit", { locationId: g.member.locationId });
    const body = await readJson(req);
    const updated = await setCheckinCode(id, body.code ? String(body.code) : null, g.admin.id);
    return NextResponse.json({ ok: true, checkinCode: updated.checkinCode });
  } catch (e) {
    return apiError(e);
  }
}
