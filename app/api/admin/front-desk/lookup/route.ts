import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi } from "@/app/api/admin/members/_shared";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { lookupByCode, lookupByScan, searchMembers } from "@/services/front-desk.service";
import { apiError } from "@/app/api/admin/members/_shared";

export const dynamic = "force-dynamic";

/** GET /api/admin/front-desk/lookup?locationSlug=&code= | &q= | &scan= — permission attendance.view */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const locationSlug = sp.get("locationSlug");
  if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug });
  if (!guard.ok) return guard.response;
  try {
    const actor = await getActorContext();
    assertCan(actor, "attendance.view", { locationId: guard.location.id });
    const code = sp.get("code");
    const scan = sp.get("scan");
    const q = sp.get("q");
    if (code) {
      const member = await lookupByCode(guard.location.id, code);
      return NextResponse.json({ member, results: member ? [member] : [] });
    }
    if (scan) {
      const member = await lookupByScan(guard.location.id, scan);
      return NextResponse.json({ member, results: member ? [member] : [] });
    }
    const results = await searchMembers(guard.location.id, q ?? "");
    return NextResponse.json({ results, member: results.length === 1 ? results[0] : null });
  } catch (e) {
    return apiError(e);
  }
}
