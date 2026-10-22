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
 *  - automation-tick             : run due automation steps, inactivity triggers, scheduled messages
 *  - expire-documents            : flip expired signed docs
 *  - build-referral-batch        : build monthly referral payout batch
 *  - reconcile-access            : nightly Kisi access state reconciliation
 *  - sync-kisi-events            : poll Kisi unlock history → check-ins (Visit rows)
 *  - sync-kisi-doors             : refresh door status/placement from Kisi
 *  - generate-invoices           : daily 09:00 UTC — recurring invoices + auto-charge default cards
 *  - retry-failed-payments       : hourly — dunning retries, late fees, mark overdue
 *  - upcoming-payment-reminders  : daily — payment.upcoming (3 days ahead) + card expiry notices
 */
import { NextRequest, NextResponse } from "next/server";
import { applyScheduledCancellations, applyScheduledFreezeTransitions } from "@/services/membership.service";
import { generateDueInvoices } from "@/services/recurring-billing.service";
import { retryFailedPayments, sendUpcomingPaymentReminders } from "@/services/dunning.service";
import { computeUsageTierSnapshots } from "@/services/usage-tier.service";
import { scoreAllMembers } from "@/services/churn-risk.service";
import { runAutomationTick } from "@/services/automation.service";
import { sendDueScheduledMessages } from "@/services/marketing.service";
import { expireOldDocumentSignings } from "@/services/document.service";
import { buildMonthlyPayoutBatch } from "@/services/referral.service";
import { reconcileAllMemberAccess } from "@/services/reconciliation.service";
import { syncDoorsFromKisi, syncKisiUnlockEvents } from "@/services/door.service";
import { isMigrationFrozen, MIGRATION_FREEZE_SKIP } from "@/lib/migration-freeze";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("x-tee24-cron-secret");
  const bearer = req.headers.get("authorization");
  if (header === secret) return true;
  if (bearer?.startsWith("Bearer ") && bearer.slice(7) === secret) return true; // Vercel Cron
  return false;
}

/** Vercel Cron invokes with GET + `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
        // Due automation steps (+ hourly inactivity triggers) and scheduled bulk messages.
        const [tick, scheduled] = await Promise.all([runAutomationTick(), sendDueScheduledMessages()]);
        return NextResponse.json({ ok: true, ...tick, scheduledMessagesSent: scheduled });
      }
      case "expire-documents": {
        const n = await expireOldDocumentSignings();
        return NextResponse.json({ ok: true, expired: n });
      }
      case "build-referral-batch": {
        if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
          return NextResponse.json({ ok: true, skipped: "PayPal not configured" });
        }
        const r = await buildMonthlyPayoutBatch({});
        return NextResponse.json({ ok: true, batches: r });
      }
      case "reconcile-access": {
        if (isMigrationFrozen()) return NextResponse.json({ ok: true, skipped: MIGRATION_FREEZE_SKIP });
        if (!process.env.KISI_API_KEY) return NextResponse.json({ ok: true, skipped: "Kisi not configured" });
        const r = await reconcileAllMemberAccess();
        return NextResponse.json({ ok: true, ...r });
      }
      case "sync-kisi-events": {
        if (!process.env.KISI_API_KEY) return NextResponse.json({ ok: true, skipped: "Kisi not configured" });
        const r = await syncKisiUnlockEvents();
        return NextResponse.json({ ok: true, ...r });
      }
      case "sync-kisi-doors": {
        if (!process.env.KISI_API_KEY) return NextResponse.json({ ok: true, skipped: "Kisi not configured" });
        const r = await syncDoorsFromKisi();
        return NextResponse.json({ ok: true, ...r });
      }
      case "generate-invoices": {
        if (isMigrationFrozen()) return NextResponse.json({ ok: true, skipped: MIGRATION_FREEZE_SKIP });
        const r = await generateDueInvoices();
        return NextResponse.json({ ok: true, ...r });
      }
      case "retry-failed-payments": {
        if (isMigrationFrozen()) return NextResponse.json({ ok: true, skipped: MIGRATION_FREEZE_SKIP });
        const r = await retryFailedPayments();
        return NextResponse.json({ ok: true, ...r });
      }
      case "upcoming-payment-reminders": {
        if (isMigrationFrozen()) return NextResponse.json({ ok: true, skipped: MIGRATION_FREEZE_SKIP });
        const r = await sendUpcomingPaymentReminders();
        return NextResponse.json({ ok: true, ...r });
      }
      default:
        return NextResponse.json({ error: `Unknown job '${job}'` }, { status: 400 });
    }
  } catch (e: unknown) {
    console.error("[cron] job failed", job, e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
