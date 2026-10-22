import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi } from "@/app/api/admin/members/_shared";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { recentCheckins } from "@/services/front-desk.service";
import { apiError } from "@/app/api/admin/members/_shared";

export const dynamic = "force-dynamic";

/** GET /api/admin/front-desk/recent?locationSlug= — today's check-ins (permission attendance.view) */
export async function GET(req: NextRequest) {
  const locationSlug = req.nextUrl.searchParams.get("locationSlug");
  if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug });
  if (!guard.ok) return guard.response;
  try {
    const actor = await getActorContext();
    assertCan(actor, "attendance.view", { locationId: guard.location.id });
    const visits = await recentCheckins(guard.location.id);
    return NextResponse.json({ visits });
  } catch (e) {
    return apiError(e);
  }
}
