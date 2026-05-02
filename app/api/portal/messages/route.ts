import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/member-session";
import { getPrisma } from "@/lib/db";
import { adminNotify } from "@/lib/admin-notify";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channel, subject, body, topic } = await req.json();
  if (!body) return NextResponse.json({ error: "Message body required" }, { status: 400 });

  const prisma = getPrisma();

  // Reuse the existing conversation by member+location, or create one.
  let convo = await prisma.conversation.findFirst({
    where: { memberId: member.id, locationId: member.locationId, status: "OPEN" },
  });
  if (!convo) {
    convo = await prisma.conversation.create({
      data: {
        memberId: member.id,
        locationId: member.locationId,
        status: "OPEN",
        subject: topic ?? subject ?? "Member message",
      },
    });
  }

  const msg = await prisma.message.create({
    data: {
      conversationId: convo.id,
      memberId: member.id,
      direction: "INBOUND",
      channel: channel === "SMS" ? "SMS" : "EMAIL",
      subject: subject ?? null,
      body,
      status: "DELIVERED",
    },
  });

  void adminNotify({
    organizationId: member.organizationId,
    locationId: member.locationId,
    kind: "message.inbound",
    severity: "INFO",
    title: `New message from ${member.firstName} ${member.lastName}`,
    body: subject ?? body.slice(0, 120),
    link: `/admin/locations/${member.location?.slug}/members/list/${member.id}`,
    data: { conversationId: convo.id, messageId: msg.id },
  });

  return NextResponse.json({ ok: true, conversationId: convo.id, messageId: msg.id });
}
