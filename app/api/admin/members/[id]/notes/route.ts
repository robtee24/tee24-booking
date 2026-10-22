import { NextRequest, NextResponse } from "next/server";
import { assertCan, can } from "@/lib/permissions";
import { addMemberNote, listMemberNotes } from "@/services/member.service";
import { apiError, readJson, requireMemberApi } from "../../_shared";

export const dynamic = "force-dynamic";

/** GET /api/admin/members/[id]/notes — member notes + internal notes (internal needs member.view-internal-notes) */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    const includeInternal = can(g.actor, "member.view-internal-notes", { locationId: g.member.locationId });
    const res = await listMemberNotes(id, { includeInternal });
    return NextResponse.json({ ...res, canViewInternal: includeInternal });
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/admin/members/[id]/notes { body, internal?: boolean } — member.edit (+ member.view-internal-notes for internal) */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "member.edit", { locationId: g.member.locationId });
    const body = await readJson(req);
    const internal = !!body.internal;
    if (internal) assertCan(g.actor, "member.view-internal-notes", { locationId: g.member.locationId });
    const note = await addMemberNote(id, String(body.body ?? ""), { internal, authorId: g.admin.id });
    return NextResponse.json({ ok: true, note: { ...note, authorName: g.admin.name ?? "Admin" }, internal });
  } catch (e) {
    return apiError(e);
  }
}
