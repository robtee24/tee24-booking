import { NextRequest, NextResponse } from "next/server";
import { guardInbox, readJson, apiError } from "../../_shared";
import { getPrisma } from "@/lib/db";
import { updateLead } from "@/services/lead.service";
import { ALL_LEAD_STAGES } from "@/components/admin/marketing/constants";

export const dynamic = "force-dynamic";

/**
 * PATCH { firstName?, lastName?, email?, phone?, stage?, notes? }
 * Lightweight lead edits from the inbox (rename, archive, mark spam, restore).
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardInbox(req);
  if (!g.ok) return g.response;
  const lead = await getPrisma().visitor.findUnique({ where: { id }, select: { locationId: true } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (g.locationIds && lead.locationId && !g.locationIds.includes(lead.locationId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await readJson(req);
  const patch: Record<string, unknown> = {};
  for (const k of ["firstName", "lastName", "email", "phone", "notes"] as const) if (body[k] !== undefined) patch[k] = body[k];
  if (body.stage !== undefined) {
    if (!(ALL_LEAD_STAGES as readonly string[]).includes(body.stage)) return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
    patch.stage = body.stage;
  }
  try {
    const updated = await updateLead(id, patch, g.admin.id);
    return NextResponse.json({ ok: true, lead: updated });
  } catch (e) {
    return apiError(e);
  }
}
