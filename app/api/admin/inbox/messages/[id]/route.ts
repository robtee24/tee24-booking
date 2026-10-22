import { NextRequest, NextResponse } from "next/server";
import { guardInbox } from "../../_shared";
import { getMessage } from "@/services/inbox.service";

export const dynamic = "force-dynamic";

/** GET — one message with full body (HTML for email). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardInbox(req);
  if (!g.ok) return g.response;
  const m = await getMessage(id);
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const loc = m.member?.locationId ?? m.locationId;
  if (g.locationIds && loc && !g.locationIds.includes(loc)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ message: m });
}
