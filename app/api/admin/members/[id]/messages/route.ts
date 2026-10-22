import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { sendEmail, sendSMS } from "@/lib/notify";
import { apiError, readJson, requireMemberApi } from "../../_shared";

export const dynamic = "force-dynamic";

/** GET /api/admin/members/[id]/messages — conversation thread (all channels) */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    const prisma = getPrisma();
    const [messages, conversations] = await Promise.all([
      prisma.message.findMany({ where: { memberId: id }, orderBy: { createdAt: "asc" }, take: 300 }),
      prisma.conversation.findMany({ where: { memberId: id }, orderBy: { lastMessageAt: "desc" } }),
    ]);
    const adminIds = Array.from(new Set(messages.map((m) => m.sentByAdminId).filter(Boolean))) as string[];
    const admins = adminIds.length ? await prisma.admin.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(admins.map((a) => [a.id, a.name]));
    return NextResponse.json({
      messages: messages.map((m) => ({ ...m, sentByAdminName: m.sentByAdminId ? names.get(m.sentByAdminId) ?? "Admin" : null })),
      conversations,
      canEmail: !!g.member.email,
      canSms: !!g.member.phone,
    });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST /api/admin/members/[id]/messages { channel: "EMAIL" | "SMS", subject?, body }
 * Sends directly to the member and logs an OUTBOUND / TRANSACTIONAL Message.
 * Permission member.edit (direct 1:1 — bulk messaging is gated separately).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "member.edit", { locationId: g.member.locationId });
    const payload = await readJson(req);
    const channel = payload.channel === "SMS" ? "SMS" : "EMAIL";
    const text = String(payload.body ?? "").trim();
    if (!text) return NextResponse.json({ error: "Message body is required" }, { status: 400 });
    const subject = channel === "EMAIL" ? String(payload.subject ?? "").trim() || `Message from ${g.location.name}` : null;
    if (channel === "SMS" && !g.member.phone) return NextResponse.json({ error: "Member has no phone number" }, { status: 400 });
    if (channel === "EMAIL" && !g.member.email) return NextResponse.json({ error: "Member has no email" }, { status: 400 });

    const prisma = getPrisma();
    let convo = await prisma.conversation.findFirst({ where: { memberId: id, locationId: g.member.locationId, status: "OPEN" }, orderBy: { lastMessageAt: "desc" } });
    if (!convo) {
      convo = await prisma.conversation.create({ data: { memberId: id, locationId: g.member.locationId, status: "OPEN", subject: subject ?? "Front desk message" } });
    }

    let status = "SENT";
    let providerError: string | null = null;
    try {
      if (channel === "SMS") await sendSMS({ to: g.member.phone, text });
      else {
        const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Helvetica,sans-serif;padding:24px;color:#0f172a;max-width:560px;margin:auto;white-space:pre-wrap;">${escapeHtml(text)}</div>`;
        await sendEmail({ to: g.member.email, subject: subject!, html });
      }
    } catch (e) {
      status = "FAILED";
      providerError = e instanceof Error ? e.message : "send failed";
    }

    const message = await prisma.message.create({
      data: {
        conversationId: convo.id,
        memberId: id,
        channel,
        direction: "OUTBOUND",
        status,
        category: "TRANSACTIONAL",
        subject,
        body: text,
        toAddress: channel === "SMS" ? g.member.phone : g.member.email,
        sentByAdminId: g.admin.id,
        providerError,
      },
    });
    await prisma.conversation.update({ where: { id: convo.id }, data: { lastMessageAt: new Date() } });
    void audit({ organizationId: g.member.organizationId, actorId: g.admin.id, actorRole: g.admin.role, action: "message.send", entityType: "Message", entityId: message.id, metadata: { channel, memberId: id } });
    return NextResponse.json({ ok: status === "SENT", message: { ...message, sentByAdminName: g.admin.name } });
  } catch (e) {
    return apiError(e);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
