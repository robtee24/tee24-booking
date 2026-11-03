import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson, requireLeadInScope } from "../../../marketing/_shared";
import { convertLead } from "@/services/lead.service";

export const dynamic = "force-dynamic";

/** POST ?slug= { firstName?, lastName?, email?, phone?, status?, optInSmsMarketing? } */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const g = await guardMarketing(req, "member.edit", { body });
  if (!g.ok) return g.response;
  const scope = await requireLeadInScope(id, g);
  if (scope) return scope;
  try {
    const res = await convertLead(id, body, g.admin.id);
    return NextResponse.json({ ok: true, memberId: res.member.id, existingMember: res.existingMember });
  } catch (e) {
    return apiError(e);
  }
}
