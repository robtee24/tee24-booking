import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError, guardMarketing, readJson } from "../../marketing/_shared";
import { signupFormDataFromBody as signupFormData } from "@/lib/signup-form-config";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardMarketing(req, ["marketing.manage-templates", "membership.edit"]);
  if (!g.ok) return g.response;
  const form = await getPrisma().signupForm.findUnique({ where: { id } });
  if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ form });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const g = await guardMarketing(req, ["marketing.manage-templates", "membership.edit"], { body });
  if (!g.ok) return g.response;
  try {
    const prisma = getPrisma();
    const before = await prisma.signupForm.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const data = signupFormData(body) as Prisma.SignupFormUncheckedUpdateInput & { slug?: string };
    if (data.slug && data.slug !== before.slug) {
      const exists = await prisma.signupForm.findUnique({ where: { slug: data.slug } });
      if (exists) return NextResponse.json({ error: `Slug "${data.slug}" is already in use` }, { status: 409 });
    }
    const form = await prisma.signupForm.update({ where: { id }, data });
    void audit({ organizationId: before.organizationId, actorId: g.admin.id, action: "settings.update", entityType: "SignupForm", entityId: id, before, after: form });
    return NextResponse.json({ ok: true, form });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardMarketing(req, ["marketing.manage-templates", "membership.edit"]);
  if (!g.ok) return g.response;
  try {
    const prisma = getPrisma();
    const before = await prisma.signupForm.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ ok: true });
    await prisma.signupForm.delete({ where: { id } });
    void audit({ organizationId: before.organizationId, actorId: g.admin.id, action: "settings.update", entityType: "SignupForm", entityId: id, before, metadata: { deleted: true } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
