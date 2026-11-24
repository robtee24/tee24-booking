import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/member-session";
import { ingestPortalMessage } from "@/services/inbox.service";

export const dynamic = "force-dynamic";

const MAX_BODY = 10_000;
const MAX_SUBJECT = 200;

/**
 * POST /api/portal/messages { channel, subject, body, topic }
 * A signed-in member writing to the team from the portal. The message is filed
 * on their conversation (admin Inbox + member profile) and emailed to the
 * front-desk mailbox.
 */
export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!body) return NextResponse.json({ error: "Message body required" }, { status: 400 });
  if (body.length > MAX_BODY) return NextResponse.json({ error: "Message too long" }, { status: 413 });
  const subject = typeof payload.subject === "string" ? payload.subject.trim().slice(0, MAX_SUBJECT) || null : null;
  const topic = typeof payload.topic === "string" ? payload.topic.trim().slice(0, 60) || null : null;

  try {
    const res = await ingestPortalMessage(member, { body, subject, topic, channel: payload.channel === "SMS" ? "SMS" : "EMAIL" });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    console.error("[portal/messages] could not record message", e);
    return NextResponse.json({ error: "Could not send your message. Please try again." }, { status: 500 });
  }
}
