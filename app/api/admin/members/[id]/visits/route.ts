import { NextRequest, NextResponse } from "next/server";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { emitMemberEvent } from "@/lib/events";
import { addManualVisit, listMemberVisits } from "@/services/attendance.service";
import { apiError, parseDate, readJson, requireMemberApi } from "../../_shared";

export const dynamic = "force-dynamic";

/** GET /api/admin/members/[id]/visits?page=&pageSize= — permission attendance.view */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "attendance.view", { locationId: g.member.locationId });
    const sp = req.nextUrl.searchParams;
    const res = await listMemberVisits(id, { page: Number(sp.get("page") || 1), pageSize: Number(sp.get("pageSize") || 25) });
    return NextResponse.json(res);
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/admin/members/[id]/visits { enteredAt?, type?, notes? } — permission attendance.add-manual */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "attendance.add-manual", { locationId: g.member.locationId });
    const body = await readJson(req);
    const type = ["RESERVATION", "WALK_IN", "DAY_PASS", "CLASS", "MANUAL"].includes(body.type) ? body.type : "MANUAL";
    const visit = await addManualVisit({
      memberId: id,
      visitorId: null,
      locationId: g.member.locationId,
      type,
      enteredAt: parseDate(body.enteredAt) ?? new Date(),
      notes: body.notes ? String(body.notes) : undefined,
      createdById: g.admin.id,
    });
    void audit({ organizationId: g.member.organizationId, actorId: g.admin.id, actorRole: g.admin.role, action: "member.update", entityType: "Visit", entityId: visit.id, after: visit, metadata: { event: "visit.manual-add" } });
    void emitMemberEvent("visit.checked-in", {
      memberId: id, locationId: g.member.locationId, organizationId: g.member.organizationId, actorAdminId: g.admin.id,
      refs: { visitId: visit.id }, vars: { visitType: type, manual: "yes" },
    });
    return NextResponse.json({ ok: true, visit });
  } catch (e) {
    return apiError(e);
  }
}
