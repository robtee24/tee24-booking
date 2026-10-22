import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi } from "@/app/api/admin/members/_shared";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { walkInGuest } from "@/services/front-desk.service";
import { apiError, readJson } from "@/app/api/admin/members/_shared";

export const dynamic = "force-dynamic";

/** POST /api/admin/front-desk/walk-in { locationSlug, name, phone?, email? } — permission attendance.add-manual */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body.locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug: body.locationSlug });
  if (!guard.ok) return guard.response;
  try {
    const actor = await getActorContext();
    assertCan(actor, "attendance.add-manual", { locationId: guard.location.id });
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Guest name is required" }, { status: 400 });
    const result = await walkInGuest({ locationId: guard.location.id, name, phone: body.phone, email: body.email, actorId: guard.admin.id });
    return NextResponse.json({ ok: true, visitorId: result.visitor.id, visitId: result.visit.id });
  } catch (e) {
    return apiError(e);
  }
}
