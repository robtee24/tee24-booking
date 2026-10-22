import { NextRequest, NextResponse } from "next/server";
import { requireLocationApi } from "@/app/api/admin/members/_shared";
import { getPrisma } from "@/lib/db";
import { listCustomFieldDefinitions } from "@/services/member.service";

export const dynamic = "force-dynamic";

/** GET /api/admin/custom-fields?locationSlug=&memberId? — definitions (+ current values when memberId given) */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const locationSlug = sp.get("locationSlug");
  if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
  const guard = await requireLocationApi({ locationSlug });
  if (!guard.ok) return guard.response;
  const loc = await getPrisma().location.findUnique({ where: { id: guard.location.id }, select: { organizationId: true } });
  const fields = await listCustomFieldDefinitions(loc?.organizationId ?? null);
  const memberId = sp.get("memberId");
  let values: Record<string, unknown> = {};
  if (memberId) {
    const rows = await getPrisma().customFieldValue.findMany({ where: { memberId, fieldId: { in: fields.map((f) => f.id) } } });
    values = Object.fromEntries(rows.map((r) => [r.fieldId, r.valueText ?? r.valueNumber ?? r.valueDate ?? r.valueJson ?? null]));
  }
  return NextResponse.json({ fields, values });
}
