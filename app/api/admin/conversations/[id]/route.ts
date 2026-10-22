import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson } from "../../marketing/_shared";
import { assignConversation, getConversation, markConversationRead, setConversationStatus } from "@/services/inbox.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** GET ?slug= — thread (marks inbound as read). */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardMarketing(req, ["member.view", "member.bulk-message"]);
  if (!g.ok) return g.response;
  const c = await getConversation(id);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.nextUrl.searchParams.get("markRead") !== "0") await markConversationRead(id);
  return NextResponse.json({ conversation: c });
}

/** PATCH ?slug= { status?: OPEN|RESOLVED, assignedToId?: string|null, read?: true } */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const g = await guardMarketing(req, ["member.bulk-message", "member.view"], { body });
  if (!g.ok) return g.response;
  try {
    if (body.status === "OPEN" || body.status === "RESOLVED") await setConversationStatus(id, body.status, g.admin.id);
    if (body.assignedToId !== undefined) await assignConversation(id, body.assignedToId || null, g.admin.id);
    if (body.read) await markConversationRead(id);
    const c = await getConversation(id);
    return NextResponse.json({ ok: true, conversation: c });
  } catch (e) {
    return apiError(e);
  }
}
