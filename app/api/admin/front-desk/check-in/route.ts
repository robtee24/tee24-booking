import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi } from "@/app/api/admin/members/_shared";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { checkInMember, lookupByCode, lookupByScan } from "@/services/front-desk.service";
import { apiError, readJson } from "@/app/api/admin/members/_shared";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/front-desk/check-in { locationSlug, memberId? | code? | scan?, override?, notes? }
 * Permission attendance.add-manual (override additionally requires attendance.edit).
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body.locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug: body.locationSlug });
  if (!guard.ok) return guard.response;
  try {
    const actor = await getActorContext();
    assertCan(actor, "attendance.add-manual", { locationId: guard.location.id });
    if (body.override) assertCan(actor, "attendance.edit", { locationId: guard.location.id });

    let memberId: string | null = body.memberId ? String(body.memberId) : null;
    if (!memberId && body.code) memberId = (await lookupByCode(guard.location.id, String(body.code)))?.id ?? null;
    if (!memberId && body.scan) memberId = (await lookupByScan(guard.location.id, String(body.scan)))?.id ?? null;
    if (!memberId) return NextResponse.json({ error: "No member matches that code", notFound: true }, { status: 404 });

    const result = await checkInMember({ locationId: guard.location.id, memberId, actorId: guard.admin.id, override: !!body.override, notes: body.notes });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (e) {
    return apiError(e);
  }
}
