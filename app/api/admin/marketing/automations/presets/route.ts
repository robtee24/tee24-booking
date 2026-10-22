import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson } from "../../_shared";
import { AUTOMATION_PRESETS, createAutomationFromPreset } from "@/services/automation.service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardMarketing(req, "marketing.manage-automations");
  if (!g.ok) return g.response;
  return NextResponse.json({ items: AUTOMATION_PRESETS.map((p) => ({ key: p.key, name: p.name, description: p.description, steps: p.input.steps?.length ?? 0, trigger: p.input.trigger })) });
}

/** POST ?slug= { key } — create an automation from a prebuilt preset. */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.manage-automations", { body });
  if (!g.ok) return g.response;
  try {
    const a = await createAutomationFromPreset(body.key, g.location.organizationId, g.admin.id);
    return NextResponse.json({ ok: true, automation: a });
  } catch (e) {
    return apiError(e);
  }
}
