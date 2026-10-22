import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson } from "../marketing/_shared";
import { listConversations, startConversation, type InboxFilter } from "@/services/inbox.service";

export const dynamic = "force-dynamic";

/** GET ?slug=&status=OPEN|RESOLVED|ALL&channel=&unread=1&assignedToId=&search= */
export async function GET(req: NextRequest) {
  const g = await guardMarketing(req, ["member.view", "member.bulk-message"]);
  if (!g.ok) return g.response;
  const sp = req.nextUrl.searchParams;
  try {
    const items = await listConversations({
      locationId: g.location.id,
      status: (sp.get("status") as InboxFilter["status"]) || "OPEN",
      channel: (sp.get("channel") as InboxFilter["channel"]) || undefined,
      unreadOnly: sp.get("unread") === "1",
      assignedToId: sp.get("assignedToId") || undefined,
      search: sp.get("search") || undefined,
    });
    return NextResponse.json({ items });
  } catch (e) {
    return apiError(e, 500);
  }
}

/** POST ?slug= { memberId, channel, subject?, body } — start a new thread. */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const g = await guardMarketing(req, ["member.bulk-message", "marketing.send-bulk"], { body });
  if (!g.ok) return g.response;
  if (!body.memberId || !body.body || (body.channel !== "EMAIL" && body.channel !== "SMS")) {
    return NextResponse.json({ error: "memberId, channel and body required" }, { status: 400 });
  }
  try {
    const res = await startConversation(body, { id: g.admin.id });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (e) {
    return apiError(e);
  }
}
