// /api/admin/mobile/devices — bound member devices.
//   GET    ?q=<name/phone>&memberId=   → active devices (+ summary for a single member)
//   DELETE { memberId, reason? }       → unlock: revoke the member's device + sessions so they can sign in on a new phone
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { isFullAccess } from "@/lib/access";
import { getPrisma } from "@/lib/db";
import { memberDeviceSummary, MobileError, unlockMemberDevice } from "@/services/mobile-auth.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEMBER_SELECT = { id: true, firstName: true, lastName: true, phone: true, email: true, locationId: true, location: { select: { slug: true, name: true } } } as const;

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const prisma = getPrisma();
  const sp = req.nextUrl.searchParams;
  const scope = isFullAccess(guard.admin.role) ? {} : { member: { locationId: { in: guard.admin.locations.map((l) => l.locationId) } } };

  const memberId = sp.get("memberId");
  if (memberId) {
    const member = await prisma.member.findUnique({ where: { id: memberId }, select: MEMBER_SELECT });
    if (!member) return NextResponse.json({ ok: false, error: "Member not found" }, { status: 404 });
    if (!isFullAccess(guard.admin.role) && !guard.admin.locations.some((l) => l.locationId === member.locationId)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ ok: true, member, ...(await memberDeviceSummary(memberId)) });
  }

  const q = sp.get("q")?.trim() ?? "";
  const digits = q.replace(/\D/g, "");
  const devices = await prisma.memberDevice.findMany({
    where: {
      revokedAt: null,
      ...scope,
      ...(q
        ? {
            member: {
              ...(scope.member ?? {}),
              OR: [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
              ],
            },
          }
        : {}),
    },
    include: { member: { select: MEMBER_SELECT } },
    orderBy: { lastSeenAt: "desc" },
    take: 200,
  });
  const [total, activeSessions] = await Promise.all([
    prisma.memberDevice.count({ where: { revokedAt: null, ...scope } }),
    prisma.mobileSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() }, ...(scope.member ? { member: scope.member } : {}) } }),
  ]);
  return NextResponse.json({ ok: true, devices, total, activeSessions });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as { memberId?: string };
    if (!body.memberId) return NextResponse.json({ ok: false, error: "memberId required" }, { status: 400 });
    const member = await getPrisma().member.findUnique({ where: { id: body.memberId }, select: { locationId: true } });
    if (!member) return NextResponse.json({ ok: false, error: "Member not found" }, { status: 404 });
    if (!isFullAccess(guard.admin.role) && !guard.admin.locations.some((l) => l.locationId === member.locationId)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    const result = await unlockMemberDevice(body.memberId, guard.admin.id, "admin_unlock");
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof MobileError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    console.error("[admin/mobile/devices]", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}
