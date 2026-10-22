import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { addCredit, getCreditBalanceCents } from "@/services/billing.service";
import { apiError, readJson, requireMemberApi, toCents } from "../../_shared";

export const dynamic = "force-dynamic";

/** GET /api/admin/members/[id]/credits — balance + ledger (permission billing.view) */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "billing.view", { locationId: g.member.locationId });
    const [balanceCents, ledger] = await Promise.all([
      getCreditBalanceCents(id),
      getPrisma().memberCredit.findMany({ where: { memberId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    return NextResponse.json({ balanceCents, ledger });
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/admin/members/[id]/credits { amount | amountCents, type?, reason } — permission billing.add-credit */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "billing.add-credit", { locationId: g.member.locationId });
    const body = await readJson(req);
    const amountCents = body.amountCents != null ? Math.round(Number(body.amountCents)) : toCents(body.amount);
    if (!Number.isFinite(amountCents) || amountCents === 0) return NextResponse.json({ error: "Amount must be non-zero" }, { status: 400 });
    const type = ["REFERRAL", "COMP", "REFUND_AS_CREDIT", "ADJUSTMENT"].includes(body.type) ? body.type : "ADJUSTMENT";
    const credit = await addCredit({ memberId: id, amountCents, type, reason: body.reason ? String(body.reason) : undefined, actorId: g.admin.id });
    const balanceCents = await getCreditBalanceCents(id);
    return NextResponse.json({ ok: true, credit, balanceCents });
  } catch (e) {
    return apiError(e);
  }
}
