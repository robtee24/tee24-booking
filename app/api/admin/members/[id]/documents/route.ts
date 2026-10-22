import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { assertCan, can } from "@/lib/permissions";
import { emitMemberEvent } from "@/lib/events";
import { assignDocument } from "@/services/document.service";
import { apiError, parseDate, readJson, requireMemberApi } from "../../_shared";

export const dynamic = "force-dynamic";

function signingUrl(token: string | null): string | null {
  if (!token) return null;
  const base = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  return `${base}/sign/${encodeURIComponent(token)}`;
}

/** GET /api/admin/members/[id]/documents — assignments + assignable library */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    const prisma = getPrisma();
    const [assignments, library] = await Promise.all([
      prisma.documentAssignment.findMany({
        where: { memberId: id },
        orderBy: { createdAt: "desc" },
        include: { document: { select: { id: true, name: true, requiredAtSignup: true, expiresAfterDays: true, version: true } }, events: { orderBy: { createdAt: "desc" }, take: 5 } },
      }),
      prisma.document.findMany({
        where: { active: true, OR: [{ organizationId: g.location.organizationId }, { organizationId: null }] },
        orderBy: { name: "asc" },
        select: { id: true, name: true, requiredAtSignup: true, version: true, description: true },
      }),
    ]);
    const canViewSigned = can(g.actor, "document.view-signed", { locationId: g.member.locationId });
    return NextResponse.json({
      assignments: assignments.map((a) => ({
        ...a,
        signingUrl: a.status === "SENT" || a.status === "VIEWED" ? signingUrl(a.signingToken) : null,
        pdfUrl: canViewSigned ? a.pdfUrl : null,
        signingToken: undefined,
      })),
      library,
    });
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/admin/members/[id]/documents { documentId, expiresAt?, notifyEmail?, notifySms? } — permission document.assign */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "document.assign", { locationId: g.member.locationId });
    const body = await readJson(req);
    if (!body.documentId) return NextResponse.json({ error: "documentId required" }, { status: 400 });
    const assignment = await assignDocument({
      documentId: String(body.documentId),
      memberId: id,
      expiresAt: parseDate(body.expiresAt) ?? null,
      notify: { email: body.notifyEmail !== false, sms: !!body.notifySms },
      actorId: g.admin.id,
    });
    const doc = await getPrisma().document.findUnique({ where: { id: String(body.documentId) }, select: { name: true } });
    void emitMemberEvent("document.assigned", {
      memberId: id, locationId: g.member.locationId, organizationId: g.member.organizationId, actorAdminId: g.admin.id,
      refs: { assignmentId: assignment.id }, vars: { documentName: doc?.name ?? "", signingUrl: signingUrl(assignment.signingToken) },
    });
    return NextResponse.json({ ok: true, assignment: { ...assignment, signingUrl: signingUrl(assignment.signingToken), signingToken: undefined } });
  } catch (e) {
    return apiError(e);
  }
}
