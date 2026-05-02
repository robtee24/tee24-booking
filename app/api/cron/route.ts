/**
 * Single cron entrypoint. External scheduler hits with `?job=<name>`.
 *
 * Authenticated via x-tee24-cron-secret header (CRON_SECRET env).
 *
 * Available jobs:
 *  - apply-cancellations         : transition CANCEL_SCHEDULED -> CANCELLED past due
 *  - apply-freezes              : transition freeze schedules
 *  - score-churn                 : recompute ChurnRiskScore for all members
 *  - usage-tier                  : nightly cohort percentile snapshots
 *  - automation-tick             : run due automation steps
 *  - expire-documents            : flip expired signed docs
 *  - build-referral-batch        : build monthly referral payout batch
 *  - reconcile-access            : nightly Kisi access state reconciliation
 */
import { NextRequest, NextResponse } from "next/server";
import { applyScheduledCancellations, applyScheduledFreezeTransitions } from "@/services/membership.service";
import { computeUsageTierSnapshots } from "@/services/usage-tier.service";
import { scoreAllMembers } from "@/services/churn-risk.service";
import { runDueAutomationSteps } from "@/services/automation.service";
import { expireOldDocumentSignings } from "@/services/document.service";
import { buildMonthlyPayoutBatch } from "@/services/referral.service";
import { reconcileAllMemberAccess } from "@/services/reconciliation.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const got = req.headers.get("x-tee24-cron-secret");
    if (got !== secret) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = req.nextUrl.searchParams.get("job");
  try {
    switch (job) {
      case "apply-cancellations": {
        const n = await applyScheduledCancellations();
        return NextResponse.json({ ok: true, applied: n });
      }
      case "apply-freezes": {
        const r = await applyScheduledFreezeTransitions();
        return NextResponse.json({ ok: true, ...r });
      }
      case "score-churn": {
        const n = await scoreAllMembers();
        return NextResponse.json({ ok: true, scored: n });
      }
      case "usage-tier": {
        const r = await computeUsageTierSnapshots();
        return NextResponse.json({ ok: true, ...r });
      }
      case "automation-tick": {
        const n = await runDueAutomationSteps();
        return NextResponse.json({ ok: true, executed: n });
      }
      case "expire-documents": {
        const n = await expireOldDocumentSignings();
        return NextResponse.json({ ok: true, expired: n });
      }
      case "build-referral-batch": {
        const r = await buildMonthlyPayoutBatch({});
        return NextResponse.json({ ok: true, batches: r });
      }
      case "reconcile-access": {
        const r = await reconcileAllMemberAccess();
        return NextResponse.json({ ok: true, ...r });
      }
      default:
        return NextResponse.json({ error: `Unknown job '${job}'` }, { status: 400 });
    }
  } catch (e: any) {
    console.error("[cron] job failed", job, e);
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
