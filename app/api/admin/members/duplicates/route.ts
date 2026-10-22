import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi } from "@/app/api/admin/members/_shared";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { findDuplicateGroups } from "@/services/member-merge.service";
import { apiError } from "../_shared";

export const dynamic = "force-dynamic";

/** GET /api/admin/members/duplicates?locationSlug= — duplicate groups by email / normalized phone. Permission member.view */
export async function GET(req: NextRequest) {
  const locationSlug = req.nextUrl.searchParams.get("locationSlug");
  if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug });
  if (!guard.ok) return guard.response;
  try {
    const actor = await getActorContext();
    assertCan(actor, "member.view", { locationId: guard.location.id });
    const groups = await findDuplicateGroups(guard.location.id);
    return NextResponse.json({ groups });
  } catch (e) {
    return apiError(e);
  }
}
