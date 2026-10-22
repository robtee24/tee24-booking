import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { apiError, guardMarketing, readJson } from "../marketing/_shared";
import { recordReferral } from "@/services/referral.service";
import { getMarketingSettings } from "@/services/marketing.service";

export const dynamic = "force-dynamic";

/**
 * GET ?slug= — referrals grouped by state for the referrals page.
 *  pending   = accrued, not yet in a payout batch (CREDIT referrals are paid immediately → "paid")
 *  confirmed = in a payout batch that is PENDING/APPROVED
 *  paid      = payout SENT/PAID or CREDIT kind
 *  unmatched = members with referredById set but no Referral row (needs a referrer assignment)
 */
export async function GET(req: NextRequest) {
  const g = await guardMarketing(req, "marketing.manage-referrals");
  if (!g.ok) return g.response;
  const prisma = getPrisma();
  try {
    const [referrals, payouts, unmatchedMembers] = await Promise.all([
      prisma.referral.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
      prisma.referralPayout.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
      prisma.member.findMany({
        where: { locationId: g.location.id, referredById: { not: null } },
        select: { id: true, firstName: true, lastName: true, referredById: true, joinDate: true },
        take: 200,
      }),
    ]);
    const referredIds = new Set(referrals.map((r) => r.referredMemberId));
    const unmatched = unmatchedMembers.filter((m) => !referredIds.has(m.id));

    const memberIds = Array.from(new Set([...referrals.map((r) => r.referrerId), ...referrals.map((r) => r.referredMemberId), ...payouts.map((p) => p.referrerId)]));
    const members = memberIds.length
      ? await prisma.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, firstName: true, lastName: true, email: true, status: true, referralCode: true, paypalAccount: { select: { paypalEmail: true } } } })
      : [];
    const byId = Object.fromEntries(members.map((m) => [m.id, m]));
    const payoutById = Object.fromEntries(payouts.map((p) => [p.id, p]));

    const items = referrals.map((r) => {
      const payout = r.payoutId ? payoutById[r.payoutId] : null;
      const state = r.earnedKind === "CREDIT" ? "paid" : !payout ? "pending" : ["SENT", "PAID"].includes(payout.status) ? "paid" : "confirmed";
      return { ...r, state, payout, referrer: byId[r.referrerId] ?? null, referred: byId[r.referredMemberId] ?? null };
    });
    const payoutRows = payouts.map((p) => ({ ...p, referrer: byId[p.referrerId] ?? null }));
    return NextResponse.json({ items, payouts: payoutRows, unmatched, paypalConfigured: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) });
  } catch (e) {
    return apiError(e, 500);
  }
}

/** POST ?slug= { referredMemberId, referrerId | referralCode } — record a referral manually (assign unmatched). */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.manage-referrals", { body });
  if (!g.ok) return g.response;
  if (!body.referredMemberId || (!body.referrerId && !body.referralCode)) return NextResponse.json({ error: "referredMemberId and referrerId (or referralCode) required" }, { status: 400 });
  try {
    const prisma = getPrisma();
    let referrerId: string | null = body.referrerId ?? null;
    if (!referrerId && body.referralCode) {
      const m = await prisma.member.findUnique({ where: { referralCode: String(body.referralCode).trim().toUpperCase() }, select: { id: true } });
      referrerId = m?.id ?? null;
    }
    if (!referrerId) return NextResponse.json({ error: "Referrer not found" }, { status: 404 });
    if (referrerId === body.referredMemberId) return NextResponse.json({ error: "A member cannot refer themselves" }, { status: 400 });
    const settings = await getMarketingSettings(g.location.organizationId);
    const referral = await recordReferral({
      referrerId,
      referredMemberId: body.referredMemberId,
      earnedCents: body.earnedCents ?? settings.referral.rewardCents,
      earnedKind: body.earnedKind ?? settings.referral.rewardKind,
    });
    await prisma.member.update({ where: { id: body.referredMemberId }, data: { referredById: referrerId } }).catch(() => {});
    return NextResponse.json({ ok: true, referral });
  } catch (e) {
    return apiError(e);
  }
}
