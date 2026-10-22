import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { sendEmail, sendSMS } from "@/lib/notify";
import { voidAssignment } from "@/services/document.service";
import { apiError, readJson, requireMemberApi } from "../../../_shared";

export const dynamic = "force-dynamic";

function signingUrl(token: string): string {
  const base = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  return `${base}/sign/${encodeURIComponent(token)}`;
}

/** POST /api/admin/members/[id]/documents/[assignmentId] { action: "resend", channel?: "EMAIL"|"SMS"|"BOTH" } — permission document.assign */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; assignmentId: string }> }) {
  const { id, assignmentId } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "document.assign", { locationId: g.member.locationId });
    const body = await readJson(req);
    const prisma = getPrisma();
    const a = await prisma.documentAssignment.findFirst({ where: { id: assignmentId, memberId: id }, include: { document: true } });
    if (!a) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    if (a.status === "SIGNED" || a.status === "VOIDED") return NextResponse.json({ error: `Cannot resend a ${a.status.toLowerCase()} document` }, { status: 400 });
    if (!a.signingToken) return NextResponse.json({ error: "Assignment has no signing link" }, { status: 400 });

    const link = signingUrl(a.signingToken);
    const channel = body.channel === "SMS" ? "SMS" : body.channel === "BOTH" ? "BOTH" : "EMAIL";
    if ((channel === "EMAIL" || channel === "BOTH") && g.member.email) {
      await sendEmail({
        to: g.member.email,
        subject: `Reminder: please sign ${a.document.name}`,
        ledger: { memberId: id, source: "document.request" },
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,Helvetica,sans-serif;padding:24px;color:#0f172a;max-width:560px;margin:auto;"><h1 style="font-size:20px;margin:0 0 16px;">Signature requested</h1><p style="margin:0 0 16px;color:#475569;">Hi ${g.member.firstName}, please review and sign <strong>${a.document.name}</strong>.</p><a href="${link}" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;">Open &amp; sign</a><p style="margin-top:16px;font-size:12px;color:#94a3b8;">Link: ${link}</p></div>`,
      });
    }
    if ((channel === "SMS" || channel === "BOTH") && g.member.phone) {
      await sendSMS({ to: g.member.phone, text: `Hi ${g.member.firstName}, please sign your ${a.document.name}: ${link}`, ledger: { memberId: id, source: "document.request" } });
    }
    await prisma.signatureEvent.create({ data: { assignmentId, memberId: id, kind: "RESENT", signedOnBehalfBy: g.admin.id } });
    void audit({ organizationId: g.member.organizationId, actorId: g.admin.id, actorRole: g.admin.role, action: "document.resend", entityType: "DocumentAssignment", entityId: assignmentId, metadata: { channel } });
    return NextResponse.json({ ok: true, signingUrl: link });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/admin/members/[id]/documents/[assignmentId] — void (permission document.void) */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; assignmentId: string }> }) {
  const { id, assignmentId } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "document.void", { locationId: g.member.locationId });
    const a = await getPrisma().documentAssignment.findFirst({ where: { id: assignmentId, memberId: id } });
    if (!a) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    await voidAssignment(assignmentId, g.admin.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
