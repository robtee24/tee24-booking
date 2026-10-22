import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { deleteVisit, updateVisit } from "@/services/attendance.service";
import { apiError, parseDate, readJson, requireMemberApi } from "../../../_shared";

export const dynamic = "force-dynamic";

/** PATCH /api/admin/members/[id]/visits/[visitId] { notes?, type?, enteredAt? } — permission attendance.edit */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; visitId: string }> }) {
  const { id, visitId } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "attendance.edit", { locationId: g.member.locationId });
    const v = await getPrisma().visit.findFirst({ where: { id: visitId, memberId: id } });
    if (!v) return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    const body = await readJson(req);
    const visit = await updateVisit(
      visitId,
      { notes: "notes" in body ? (body.notes ? String(body.notes) : null) : undefined, type: body.type ? String(body.type) : undefined, enteredAt: parseDate(body.enteredAt) },
      g.admin.id,
    );
    return NextResponse.json({ ok: true, visit });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/admin/members/[id]/visits/[visitId] — permission attendance.edit */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; visitId: string }> }) {
  const { id, visitId } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "attendance.edit", { locationId: g.member.locationId });
    const v = await getPrisma().visit.findFirst({ where: { id: visitId, memberId: id } });
    if (!v) return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    await deleteVisit(visitId, g.admin.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
