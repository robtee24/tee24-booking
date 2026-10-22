import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson } from "../marketing/_shared";
import { createTemplate, listMarketingTemplates } from "@/services/marketing.service";

export const dynamic = "force-dynamic";

/** GET ?slug= — marketing/transactional templates (system templates excluded). */
export async function GET(req: NextRequest) {
  const g = await guardMarketing(req, ["marketing.manage-templates", "marketing.send-bulk"]);
  if (!g.ok) return g.response;
  const items = await listMarketingTemplates(g.location.organizationId);
  return NextResponse.json({ items });
}

/** POST ?slug= { name, channel, subject?, body, category?, active? } */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.manage-templates", { body });
  if (!g.ok) return g.response;
  if (!body.name || !body.channel || !body.body) return NextResponse.json({ error: "name, channel and body are required" }, { status: 400 });
  try {
    const row = await createTemplate({ organizationId: g.location.organizationId, name: body.name, channel: body.channel, subject: body.subject, body: body.body, category: body.category, active: body.active }, g.admin.id);
    return NextResponse.json({ ok: true, template: row });
  } catch (e) {
    return apiError(e);
  }
}
