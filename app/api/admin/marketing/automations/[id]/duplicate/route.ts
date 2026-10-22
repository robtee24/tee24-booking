import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing } from "../../../_shared";
import { duplicateAutomation } from "@/services/automation.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardMarketing(req, "marketing.manage-automations");
  if (!g.ok) return g.response;
  try {
    const a = await duplicateAutomation(id, g.admin.id);
    return NextResponse.json({ ok: true, automation: a });
  } catch (e) {
    return apiError(e);
  }
}
