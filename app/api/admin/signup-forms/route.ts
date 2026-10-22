import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError, guardMarketing, readJson } from "../marketing/_shared";
import { parseSignupFieldConfig, signupFormDataFromBody, slugify } from "@/lib/signup-form-config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardMarketing(req, ["marketing.manage-templates", "membership.edit"]);
  if (!g.ok) return g.response;
  const items = await getPrisma().signupForm.findMany({
    where: { OR: [{ organizationId: g.location.organizationId }, { locationId: g.location.id }] },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const g = await guardMarketing(req, ["marketing.manage-templates", "membership.edit"], { body });
  if (!g.ok) return g.response;
  if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });
  try {
    const data: any = signupFormDataFromBody(body);
    if (!data.slug) data.slug = slugify(body.name);
    const exists = await getPrisma().signupForm.findUnique({ where: { slug: data.slug } });
    if (exists) return NextResponse.json({ error: `Slug "${data.slug}" is already in use` }, { status: 409 });
    if (!data.requiredFields) data.requiredFields = parseSignupFieldConfig(null);
    const form = await getPrisma().signupForm.create({ data: { ...data, organizationId: g.location.organizationId, locationId: g.location.id } });
    void audit({ organizationId: g.location.organizationId, actorId: g.admin.id, action: "settings.update", entityType: "SignupForm", entityId: form.id, after: form });
    return NextResponse.json({ ok: true, form });
  } catch (e) {
    return apiError(e);
  }
}
