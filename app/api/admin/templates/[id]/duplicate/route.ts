import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing } from "../../../marketing/_shared";
import { duplicateTemplate } from "@/services/marketing.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardMarketing(req, "marketing.manage-templates");
  if (!g.ok) return g.response;
  try {
    const row = await duplicateTemplate(id, g.admin.id);
    return NextResponse.json({ ok: true, template: row });
  } catch (e) {
    return apiError(e);
  }
}
