import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan, ForbiddenError } from "@/lib/permissions";
import { buildMonthlyPayoutBatch } from "@/services/referral.service";

export const dynamic = "force-dynamic";

/** POST { autoSend?: boolean } — build the previous month's payout batch. */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const body = await req.json().catch(() => ({}));
  try {
    const actor = await getActorContext();
    assertCan(actor, "marketing.manage-referrals", {});
    if (body.autoSend) assertCan(actor, "marketing.send-payouts", {});
    const result = await buildMonthlyPayoutBatch({ autoSend: !!body.autoSend, actorId: guard.admin.id });
    return NextResponse.json({ ok: true, created: result });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
