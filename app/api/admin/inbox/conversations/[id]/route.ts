import { NextRequest, NextResponse } from "next/server";
import { guardInbox, conversationVisible, readJson, apiError } from "../../_shared";
import { assignConversation, getConversation, markConversationRead, setConversationStatus } from "@/services/inbox.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardInbox(req);
  if (!g.ok) return g.response;
  if (!(await conversationVisible(id, g.locationIds))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const c = await getConversation(id);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.nextUrl.searchParams.get("markRead") !== "0") await markConversationRead(id);
  return NextResponse.json({ conversation: c });
}

/** PATCH { status?: OPEN|RESOLVED, assignedToId?: string|null, read?: true } */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardInbox(req);
  if (!g.ok) return g.response;
  if (!(await conversationVisible(id, g.locationIds))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await readJson(req);
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
