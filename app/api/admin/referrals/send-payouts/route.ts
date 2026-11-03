import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan, ForbiddenError } from "@/lib/permissions";
import { isFullAccess } from "@/lib/access";
import { getPrisma } from "@/lib/db";
import { sendPayoutBatch } from "@/services/referral.service";

export const dynamic = "force-dynamic";

/** POST { payoutIds: string[] } — send approved payouts via PayPal. Env-gated. */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.payoutIds) || body.payoutIds.length === 0) {
    return NextResponse.json({ error: "payoutIds[] required" }, { status: 400 });
  }
  const payoutIds: string[] = Array.from(new Set((body.payoutIds as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)));
  if (payoutIds.length === 0 || payoutIds.length > 500) {
    return NextResponse.json({ error: "payoutIds[] must contain 1–500 ids" }, { status: 400 });
  }
  if (!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET)) {
    return NextResponse.json({ error: "PayPal is not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)" }, { status: 503 });
  }
  try {
    const actor = await getActorContext();
    assertCan(actor, "marketing.send-payouts", {});

    // Payouts are org-wide rows keyed only by referrer; a SCOPED admin may only
    // send money for members of their own locations.
    if (!isFullAccess(actor.role)) {
      const allowed = actor.locationIds ?? [];
      const payouts = await getPrisma().referralPayout.findMany({
        where: { id: { in: payoutIds } },
        select: { id: true, referrerId: true },
      });
      if (payouts.length !== payoutIds.length) return NextResponse.json({ error: "One or more payouts not found" }, { status: 404 });
      const referrerIds = Array.from(new Set(payouts.map((p) => p.referrerId)));
      const members = await getPrisma().member.findMany({ where: { id: { in: referrerIds } }, select: { id: true, locationId: true } });
      const inScope = members.length === referrerIds.length && members.every((m) => allowed.includes(m.locationId));
      if (!inScope) return NextResponse.json({ error: "One or more payouts are outside your locations" }, { status: 403 });
    }

    const result = await sendPayoutBatch(payoutIds, { actorId: guard.admin.id });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
