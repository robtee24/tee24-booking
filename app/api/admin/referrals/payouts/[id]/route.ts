import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { apiError, guardMarketing, readJson } from "../../../marketing/_shared";

export const dynamic = "force-dynamic";

/** PATCH ?slug= { status: APPROVED | PENDING | PAID } — approve (or mark manually paid) a payout. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.manage-referrals", { body });
  if (!g.ok) return g.response;
  if (!["APPROVED", "PENDING", "PAID"].includes(body.status)) return NextResponse.json({ error: "status must be APPROVED, PENDING or PAID" }, { status: 400 });
  try {
    const prisma = getPrisma();
    const before = await prisma.referralPayout.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (["SENT", "PAID"].includes(before.status) && body.status !== "PAID") return NextResponse.json({ error: "Payout already sent" }, { status: 400 });
    const after = await prisma.referralPayout.update({
      where: { id },
      data: { status: body.status, paidAt: body.status === "PAID" ? new Date() : undefined, paypalTxnId: body.status === "PAID" ? before.paypalTxnId ?? "manual" : undefined },
    });
    void audit({ organizationId: g.location.organizationId, actorId: g.admin.id, action: "referral.payout-create", entityType: "ReferralPayout", entityId: id, before, after });
    return NextResponse.json({ ok: true, payout: after });
  } catch (e) {
    return apiError(e);
  }
}
