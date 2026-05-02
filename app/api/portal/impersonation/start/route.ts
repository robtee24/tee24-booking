/**
 * Admin "View as member" — sets a member portal session impersonated by the admin.
 * Requires `member.impersonate` permission. Audit-logged.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/access";
import { setMemberSession } from "@/lib/member-session";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { memberId } = await req.json();
  if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });

  const member = await getPrisma().member.findUnique({
    where: { id: memberId },
    select: { id: true, locationId: true, organizationId: true },
  });
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const adminCtx = {
    id: admin.id,
    role: admin.role,
    locationIds: admin.locations.map((l: any) => l.locationId),
  };
  if (!can(adminCtx, "member.impersonate", { locationId: member.locationId })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await setMemberSession(memberId, { impersonatedBy: admin.id });

  void audit({
    organizationId: member.organizationId,
    actorId: admin.id,
    actorRole: admin.role,
    action: "member.impersonate-start",
    entityType: "Member",
    entityId: memberId,
    metadata: { ipAddress: req.headers.get("x-forwarded-for") },
  });

  return NextResponse.json({ ok: true, redirectUrl: "/portal" });
}
