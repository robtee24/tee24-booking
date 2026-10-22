import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson } from "../marketing/_shared";
import { createLead, listLeads, type LeadFilter } from "@/services/lead.service";

export const dynamic = "force-dynamic";

/** GET ?slug=&stage=&source=&assignedToId=&followUp=&search= */
export async function GET(req: NextRequest) {
  const g = await guardMarketing(req, "marketing.view-visitors");
  if (!g.ok) return g.response;
  const sp = req.nextUrl.searchParams;
  try {
    const items = await listLeads({
      locationId: g.location.id,
      stage: (sp.get("stage") as LeadFilter["stage"]) || "ALL",
      source: sp.get("source") || undefined,
      assignedToId: sp.get("assignedToId") || undefined,
      followUp: (sp.get("followUp") as LeadFilter["followUp"]) || undefined,
      search: sp.get("search") || undefined,
    });
    return NextResponse.json({ items });
  } catch (e) {
    return apiError(e, 500);
  }
}

/** POST ?slug= LeadInput */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.view-visitors", { body });
  if (!g.ok) return g.response;
  if (!body.firstName && !body.email && !body.phone) return NextResponse.json({ error: "Provide at least a name, email or phone" }, { status: 400 });
  try {
    const lead = await createLead(
      {
        organizationId: g.location.organizationId,
        locationId: g.location.id,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
        source: body.source,
        stage: body.stage,
        notes: body.notes,
        tags: Array.isArray(body.tags) ? body.tags : undefined,
        assignedToId: body.assignedToId,
        nextFollowUpAt: body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null,
      },
      g.admin.id,
    );
    return NextResponse.json({ ok: true, lead });
  } catch (e) {
    return apiError(e);
  }
}
