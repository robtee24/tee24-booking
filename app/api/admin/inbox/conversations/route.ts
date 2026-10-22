import { NextRequest, NextResponse } from "next/server";
import { guardInbox, readJson, apiError } from "../_shared";
import { listConversations, startConversation, type InboxFilter } from "@/services/inbox.service";
import { getPrisma } from "@/lib/db";
import { canAccessLocation } from "@/lib/access";

export const dynamic = "force-dynamic";

/** GET ?locationId=&status=OPEN|RESOLVED|ALL&channel=&unread=1&assignedToId=&search= */
export async function GET(req: NextRequest) {
  const g = await guardInbox(req);
  if (!g.ok) return g.response;
  const sp = req.nextUrl.searchParams;
  try {
    const items = await listConversations({
      locationIds: g.locationIds,
      status: (sp.get("status") as InboxFilter["status"]) || "OPEN",
      channel: (sp.get("channel") as InboxFilter["channel"]) || undefined,
      unreadOnly: sp.get("unread") === "1",
      assignedToId: sp.get("assignedToId") || undefined,
      search: sp.get("search") || undefined,
      take: 200,
    });
    return NextResponse.json({ items });
  } catch (e) {
    return apiError(e, 500);
  }
}

/** POST { memberId, channel, subject?, body } — start a new thread with a member. */
export async function POST(req: NextRequest) {
  const g = await guardInbox(req);
  if (!g.ok) return g.response;
  const body = await readJson(req);
  if (!body.memberId || !body.body || (body.channel !== "EMAIL" && body.channel !== "SMS")) {
    return NextResponse.json({ error: "memberId, channel and body required" }, { status: 400 });
  }
  const member = await getPrisma().member.findUnique({ where: { id: String(body.memberId) }, select: { locationId: true } });
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (g.locationIds && !canAccessLocation(g.admin.role, g.locationIds, member.locationId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const res = await startConversation({ memberId: body.memberId, channel: body.channel, subject: body.subject, body: body.body }, { id: g.admin.id });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (e) {
    return apiError(e);
  }
}
