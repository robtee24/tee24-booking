import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { apiError, guardMarketing, readJson } from "../../_shared";
import { automationStats, deleteAutomation, updateAutomation } from "@/services/automation.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardMarketing(req, "marketing.manage-automations");
  if (!g.ok) return g.response;
  const a = await getPrisma().automation.findUnique({ where: { id }, include: { steps: { orderBy: { order: "asc" } } } });
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const stats = await automationStats(id);
  return NextResponse.json({ automation: a, stats });
}

/** PATCH ?slug= Partial<AutomationInput> (steps replace the whole list when given) */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.manage-automations", { body });
  if (!g.ok) return g.response;
  try {
    const a = await updateAutomation(id, body, g.admin.id);
    return NextResponse.json({ ok: true, automation: a });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardMarketing(req, "marketing.manage-automations");
  if (!g.ok) return g.response;
  try {
    await deleteAutomation(id, g.admin.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
