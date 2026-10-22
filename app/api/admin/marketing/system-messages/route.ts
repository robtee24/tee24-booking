import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson } from "../_shared";
import { listSystemTemplates, updateSystemTemplate } from "@/services/system-messages.service";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET ?slug= — full system-message catalog for the org (lazy-seeds rows). */
export async function GET(req: NextRequest) {
  const g = await guardMarketing(req, "marketing.manage-templates");
  if (!g.ok) return g.response;
  try {
    const items = await listSystemTemplates(g.location.organizationId);
    return NextResponse.json({ items });
  } catch (e) {
    return apiError(e, 500);
  }
}

/** PATCH ?slug= { id, active?, subject?, body?, resetToDefault? } */
export async function PATCH(req: NextRequest) {
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.manage-templates", { body });
  if (!g.ok) return g.response;
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const row = await updateSystemTemplate(body.id, { active: body.active, subject: body.subject, body: body.body, resetToDefault: body.resetToDefault });
    void audit({ organizationId: g.location.organizationId, actorId: g.admin.id, action: "settings.update", entityType: "MessageTemplate", entityId: row.id, after: { active: row.active, eventKey: row.eventKey, channel: row.channel } });
    return NextResponse.json({ ok: true, template: row });
  } catch (e) {
    return apiError(e);
  }
}
