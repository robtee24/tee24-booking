import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson } from "../../../marketing/_shared";
import { logLeadActivity } from "@/services/lead.service";

export const dynamic = "force-dynamic";

/** POST ?slug= { kind, note?, nextFollowUpAt?, stage? } */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.view-visitors", { body });
  if (!g.ok) return g.response;
  if (!body.kind) return NextResponse.json({ error: "kind required" }, { status: 400 });
  try {
    const ev = await logLeadActivity(
      id,
      { kind: body.kind, note: body.note, nextFollowUpAt: body.nextFollowUpAt === undefined ? undefined : body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null, stage: body.stage },
      g.admin.id,
    );
    return NextResponse.json({ ok: true, event: ev });
  } catch (e) {
    return apiError(e);
  }
}
