import { NextRequest, NextResponse } from "next/server";
import { guardInbox, conversationVisible, readJson, apiError } from "../../../_shared";
import { replyToConversation } from "@/services/inbox.service";

export const dynamic = "force-dynamic";

/** POST { channel?: EMAIL|SMS, subject?, body } */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardInbox(req);
  if (!g.ok) return g.response;
  if (!(await conversationVisible(id, g.locationIds))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await readJson(req);
  if (!body.body?.trim()) return NextResponse.json({ error: "body required" }, { status: 400 });
  try {
    const res = await replyToConversation(id, { channel: body.channel, subject: body.subject, body: body.body }, { id: g.admin.id });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (e) {
    return apiError(e);
  }
}
