import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan, ForbiddenError } from "@/lib/permissions";
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
  if (!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET)) {
    return NextResponse.json({ error: "PayPal is not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)" }, { status: 503 });
  }
  try {
    const actor = await getActorContext();
    assertCan(actor, "marketing.send-payouts", {});
    const result = await sendPayoutBatch(body.payoutIds, { actorId: guard.admin.id });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
