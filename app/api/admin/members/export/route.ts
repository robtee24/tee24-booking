import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi } from "@/app/api/admin/members/_shared";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { exportMembersCsv } from "@/services/member-export.service";
import { apiError, memberQueryFromParams } from "../_shared";

export const dynamic = "force-dynamic";

/** GET /api/admin/members/export?locationSlug=&...same filters as list — CSV download. Permission member.export */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const locationSlug = sp.get("locationSlug");
  if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug });
  if (!guard.ok) return guard.response;
  try {
    const actor = await getActorContext();
    assertCan(actor, "member.export", { locationId: guard.location.id });
    const q = memberQueryFromParams(sp, guard.location.id);
    const { csv, count } = await exportMembersCsv(q);
    void audit({ actorId: guard.admin.id, actorRole: guard.admin.role, action: "member.update", entityType: "Location", entityId: guard.location.id, metadata: { event: "member.export", count, filters: Object.fromEntries(sp.entries()) } });
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="members-${guard.location.slug}-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
