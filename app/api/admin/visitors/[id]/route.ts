import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson, requireLeadInScope } from "../../marketing/_shared";
import { deleteLead, getLead, updateLead, type LeadInput } from "@/services/lead.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Fields updateLead() actually applies; locationId/organizationId are deliberately excluded.
const PATCH_FIELDS = ["firstName", "lastName", "email", "phone", "source", "stage", "notes", "tags", "assignedToId"] as const;

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardMarketing(req, "marketing.view-visitors");
  if (!g.ok) return g.response;
  const scope = await requireLeadInScope(id, g);
  if (scope) return scope;
  const lead = await getLead(id);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ lead });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.view-visitors", { body });
  if (!g.ok) return g.response;
  const scope = await requireLeadInScope(id, g);
  if (scope) return scope;
  try {
    // Copy only known lead fields rather than forwarding the whole body.
    const patch: Record<string, unknown> = {};
    for (const k of PATCH_FIELDS) if (k in body) patch[k] = body[k];
    if (body.nextFollowUpAt !== undefined) patch.nextFollowUpAt = body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null;
    const lead = await updateLead(id, patch as Partial<LeadInput>, g.admin.id);
    return NextResponse.json({ ok: true, lead });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardMarketing(req, "marketing.view-visitors");
  if (!g.ok) return g.response;
  const scope = await requireLeadInScope(id, g);
  if (scope) return scope;
  try {
    await deleteLead(id, g.admin.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
