import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson } from "../../marketing/_shared";
import { deleteLead, getLead, updateLead } from "@/services/lead.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardMarketing(req, "marketing.view-visitors");
  if (!g.ok) return g.response;
  const lead = await getLead(id);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ lead });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.view-visitors", { body });
  if (!g.ok) return g.response;
  try {
    const patch: any = { ...body };
    if (body.nextFollowUpAt !== undefined) patch.nextFollowUpAt = body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null;
    const lead = await updateLead(id, patch, g.admin.id);
    return NextResponse.json({ ok: true, lead });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardMarketing(req, "marketing.view-visitors");
  if (!g.ok) return g.response;
  try {
    await deleteLead(id, g.admin.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
