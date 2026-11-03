import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError, guardMarketing, readJson, requireMembersInScope } from "../../marketing/_shared";

export const dynamic = "force-dynamic";

/** PATCH ?slug= { referrerId?, earnedCents? } — reassign a referral to a different member. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.manage-referrals", { body });
  if (!g.ok) return g.response;
  try {
    const prisma = getPrisma();
    const before = await prisma.referral.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Referrals carry no location of their own: scope by the members involved,
    // including the proposed new referrer.
    const scope = await requireMembersInScope([before.referrerId, before.referredMemberId, body.referrerId], g);
    if (scope) return scope;
    if (before.payoutId) return NextResponse.json({ error: "Referral is already in a payout batch" }, { status: 400 });
    const data: { referrerId?: string; earnedCents?: number } = {};
    if (typeof body.referrerId === "string" && body.referrerId) data.referrerId = body.referrerId;
    if (typeof body.earnedCents === "number") data.earnedCents = Math.max(0, Math.round(body.earnedCents));
    const after = await prisma.referral.update({ where: { id }, data });
    if (data.referrerId) await prisma.member.update({ where: { id: before.referredMemberId }, data: { referredById: data.referrerId } }).catch(() => {});
    void audit({ organizationId: g.location.organizationId, actorId: g.admin.id, action: "settings.update", entityType: "Referral", entityId: id, before, after });
    return NextResponse.json({ ok: true, referral: after });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardMarketing(req, "marketing.manage-referrals");
  if (!g.ok) return g.response;
  try {
    const prisma = getPrisma();
    const before = await prisma.referral.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ ok: true });
    const scope = await requireMembersInScope([before.referrerId, before.referredMemberId], g);
    if (scope) return scope;
    if (before.payoutId) return NextResponse.json({ error: "Referral is already in a payout batch" }, { status: 400 });
    await prisma.referral.delete({ where: { id } });
    void audit({ organizationId: g.location.organizationId, actorId: g.admin.id, action: "settings.update", entityType: "Referral", entityId: id, before, metadata: { deleted: true } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
