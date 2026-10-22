import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson } from "../../_shared";
import { setAllAutomationsActive } from "@/services/automation.service";

export const dynamic = "force-dynamic";

/** POST ?slug= { active: boolean } — Pause all / Resume all. */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.manage-automations", { body });
  if (!g.ok) return g.response;
  try {
    const count = await setAllAutomationsActive(g.location.organizationId, !!body.active, g.admin.id);
    return NextResponse.json({ ok: true, count });
  } catch (e) {
    return apiError(e);
  }
}
