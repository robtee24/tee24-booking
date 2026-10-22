import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { apiError, guardMarketing, readJson } from "../_shared";
import { createAutomation } from "@/services/automation.service";

export const dynamic = "force-dynamic";

/** GET ?slug= — automations for the org with counts. */
export async function GET(req: NextRequest) {
  const g = await guardMarketing(req, "marketing.manage-automations");
  if (!g.ok) return g.response;
  const items = await getPrisma().automation.findMany({
    where: { OR: [{ organizationId: g.location.organizationId }, { organizationId: null }] },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { steps: true, enrollments: true } } },
  });
  return NextResponse.json({ items });
}

/** POST ?slug= AutomationInput */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.manage-automations", { body });
  if (!g.ok) return g.response;
  if (!body.name || !body.trigger) return NextResponse.json({ error: "name and trigger required" }, { status: 400 });
  try {
    const a = await createAutomation(
      {
        organizationId: g.location.organizationId,
        name: body.name,
        description: body.description ?? null,
        trigger: body.trigger,
        triggerConfig: body.triggerConfig ?? {},
        goalConfig: body.goalConfig ?? null,
        active: body.active ?? false,
        maxSteps: body.maxSteps,
        steps: body.steps ?? [],
      },
      g.admin.id,
    );
    return NextResponse.json({ ok: true, automation: a });
  } catch (e) {
    return apiError(e);
  }
}
