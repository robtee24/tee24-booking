import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson } from "../../marketing/_shared";
import { deleteTemplate, updateTemplate } from "@/services/marketing.service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH ?slug= { name?, channel?, subject?, body?, active? } */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.manage-templates", { body });
  if (!g.ok) return g.response;
  try {
    const row = await updateTemplate(id, body, g.admin.id);
    return NextResponse.json({ ok: true, template: row });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardMarketing(req, "marketing.manage-templates");
  if (!g.ok) return g.response;
  try {
    await deleteTemplate(id, g.admin.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
