import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { apiError, guardMarketing, readJson } from "../../../_shared";
import { enrollMember, removeEnrollment } from "@/services/automation.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** GET ?slug=&status= — enrollments with member summary. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guardMarketing(req, "marketing.manage-automations");
  if (!g.ok) return g.response;
  const status = req.nextUrl.searchParams.get("status");
  const items = await getPrisma().automationEnrollment.findMany({
    where: { automationId: id, ...(status ? { status } : {}) },
    orderBy: { enrolledAt: "desc" },
    take: 200,
    include: { member: { select: { id: true, firstName: true, lastName: true, email: true, status: true } } },
  });
  return NextResponse.json({ items });
}

/** POST ?slug= { memberId } — manual enroll */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.manage-automations", { body });
  if (!g.ok) return g.response;
  if (!body.memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });
  try {
    const e = await enrollMember(id, body.memberId, g.admin.id);
    return NextResponse.json({ ok: true, enrollment: e });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE ?slug=&enrollmentId= — remove (exit) an enrollment */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  await ctx.params;
  const g = await guardMarketing(req, "marketing.manage-automations");
  if (!g.ok) return g.response;
  const enrollmentId = req.nextUrl.searchParams.get("enrollmentId");
  if (!enrollmentId) return NextResponse.json({ error: "enrollmentId required" }, { status: 400 });
  try {
    await removeEnrollment(enrollmentId, g.admin.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
