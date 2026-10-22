import { NextRequest, NextResponse } from "next/server";
import { getMemberSession, clearMemberSession } from "@/lib/member-session";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminRoutes } from "@/lib/admin/routes";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/impersonation/stop
 * Ends an admin "view as member" session. Returns JSON for fetch() callers and
 * redirects back to the member's admin profile for plain HTML form posts.
 */
export async function POST(req: NextRequest) {
  const sess = await getMemberSession();
  let redirectTo: string = adminRoutes.home();
  if (sess?.impersonatedBy) {
    void audit({
      actorId: sess.impersonatedBy,
      actorRole: "ADMIN",
      action: "member.impersonate-end",
      entityType: "Member",
      entityId: sess.sub,
    });
    const member = await getPrisma().member.findUnique({ where: { id: sess.sub }, select: { id: true, location: { select: { slug: true } } } }).catch(() => null);
    if (member?.location?.slug) redirectTo = adminRoutes.loc.members.detail(member.location.slug, member.id);
  }
  await clearMemberSession();

  const accept = req.headers.get("accept") ?? "";
  const contentType = req.headers.get("content-type") ?? "";
  const isFormPost = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data") || (accept.includes("text/html") && !accept.includes("application/json"));
  if (isFormPost) {
    return NextResponse.redirect(new URL(redirectTo, req.nextUrl.origin), { status: 303 });
  }
  return NextResponse.json({ ok: true, redirectTo });
}
