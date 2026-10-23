// GET /api/members/[id]/photo — the member's stored profile photo.
//
// Allowed for the member themselves (portal session) or an admin of the
// member's location with `member.view`.
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getMemberSession } from "@/lib/member-session";
import { requireLocationAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id }, select: { id: true, locationId: true } });
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sess = await getMemberSession().catch(() => null);
  let allowed = Boolean(sess && sess.sub === member.id);
  if (!allowed) {
    const guard = await requireLocationAdminApi({ locationId: member.locationId });
    if (guard.ok) {
      const actor = await getActorContext();
      allowed = Boolean(actor && can(actor, "member.view", { locationId: member.locationId }));
    }
  }
  if (!allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const photo = await prisma.memberPhoto.findUnique({ where: { memberId: member.id } });
  if (!photo) return NextResponse.json({ error: "No photo" }, { status: 404 });

  return new NextResponse(new Uint8Array(photo.data), {
    status: 200,
    headers: {
      "Content-Type": photo.mimeType,
      "Content-Length": String(photo.sizeBytes),
      "Cache-Control": "private, max-age=3600",
      ETag: `"${photo.sha256.slice(0, 16)}"`,
    },
  });
}
