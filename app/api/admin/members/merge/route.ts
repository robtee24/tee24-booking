import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi } from "@/app/api/admin/members/_shared";
import { getPrisma } from "@/lib/db";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { mergeMembers } from "@/services/member-merge.service";
import { apiError, readJson } from "../_shared";

export const dynamic = "force-dynamic";

/** POST /api/admin/members/merge { locationSlug, survivorId, loserIds: string[] } — permission member.edit + member.delete */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const { locationSlug } = body;
  if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug });
  if (!guard.ok) return guard.response;
  try {
    const actor = await getActorContext();
    assertCan(actor, "member.edit", { locationId: guard.location.id });
    assertCan(actor, "member.delete", { locationId: guard.location.id });
    const survivorId = String(body.survivorId ?? "");
    const loserIds: string[] = Array.isArray(body.loserIds) ? body.loserIds.map(String) : [];
    if (!survivorId || loserIds.length === 0) return NextResponse.json({ error: "survivorId and loserIds are required" }, { status: 400 });
    const all = await getPrisma().member.findMany({ where: { id: { in: [survivorId, ...loserIds] } }, select: { id: true, locationId: true } });
    if (all.length !== new Set([survivorId, ...loserIds]).size || all.some((m) => m.locationId !== guard.location.id)) {
      return NextResponse.json({ error: "All members must exist and belong to this location" }, { status: 400 });
    }
    const result = await mergeMembers({ survivorId, loserIds, actorId: guard.admin.id });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return apiError(e);
  }
}
