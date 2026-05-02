/**
 * Referral program service.
 *
 * - Per-member referral codes are generated at signup.
 * - When a referred member completes signup, we accrue a Referral row.
 * - Monthly cron generates ReferralPayout rows from accrued referrals; admin
 *   may auto-batch (configured) or require approval before sending via PayPal Payouts.
 * - 1099-NEC at year-end for any referrer ≥ $600 (paid via PAYMENT path; CREDIT
 *   path is not 1099-reportable).
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { paypalSendBatchPayout } from "@/lib/paypal";
import { adminNotify } from "@/lib/admin-notify";
import { addCredit } from "./billing.service";

export async function recordReferral(opts: {
  referrerId: string;
  referredMemberId: string;
  signupFormId?: string | null;
  earnedCents: number;
  earnedKind: "PAYMENT" | "CREDIT";
  discountAppliedId?: string | null;
}) {
  const prisma = getPrisma();
  const referral = await prisma.referral.create({
    data: {
      referrerId: opts.referrerId,
      referredMemberId: opts.referredMemberId,
      signupFormId: opts.signupFormId ?? null,
      earnedCents: opts.earnedCents,
      earnedKind: opts.earnedKind,
      discountAppliedId: opts.discountAppliedId ?? null,
    },
  });

  // For CREDIT path, post immediately to the referrer's credit ledger.
  if (opts.earnedKind === "CREDIT") {
    await addCredit({
      memberId: opts.referrerId,
      amountCents: opts.earnedCents,
      type: "REFERRAL",
      reason: `Referral credit for new member ${opts.referredMemberId}`,
    });
  }

  void audit({
    action: "membership.create", // best-fit existing audit action
    entityType: "Referral",
    entityId: referral.id,
    after: referral,
  });

  return referral;
}

/**
 * Build the next ReferralPayout batch for the previous calendar month.
 * Pays referrers whose accrued PAYMENT-type referrals haven't been paid yet.
 */
export async function buildMonthlyPayoutBatch(opts: { now?: Date; autoSend?: boolean; actorId?: string }) {
  const prisma = getPrisma();
  const now = opts.now ?? new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const referrals = await prisma.referral.findMany({
    where: {
      earnedKind: "PAYMENT",
      payoutId: null,
      createdAt: { gte: periodStart, lt: periodEnd },
    },
  });

  // Group by referrer
  const byReferrer = new Map<string, { totalCents: number; ids: string[] }>();
  for (const r of referrals) {
    const cur = byReferrer.get(r.referrerId) ?? { totalCents: 0, ids: [] };
    cur.totalCents += r.earnedCents;
    cur.ids.push(r.id);
    byReferrer.set(r.referrerId, cur);
  }

  const created: { referrerId: string; payoutId: string; amountCents: number }[] = [];
  for (const [referrerId, agg] of byReferrer.entries()) {
    const payout = await prisma.referralPayout.create({
      data: {
        referrerId,
        amountCents: agg.totalCents,
        periodStart,
        periodEnd,
        status: opts.autoSend ? "APPROVED" : "PENDING",
      },
    });
    await prisma.referral.updateMany({
      where: { id: { in: agg.ids } },
      data: { payoutId: payout.id },
    });
    created.push({ referrerId, payoutId: payout.id, amountCents: agg.totalCents });
  }

  void audit({
    actorId: opts.actorId,
    action: "referral.payout-create",
    entityType: "ReferralPayoutBatch",
    entityId: `batch_${periodStart.toISOString().slice(0, 7)}`,
    metadata: { count: created.length, period: { start: periodStart, end: periodEnd } },
  });

  if (opts.autoSend) {
    await sendPayoutBatch(created.map((c) => c.payoutId), { actorId: opts.actorId });
  }

  return created;
}

/**
 * Send a batch of approved payouts via PayPal Payouts API.
 */
export async function sendPayoutBatch(payoutIds: string[], opts?: { actorId?: string }) {
  const prisma = getPrisma();
  const payouts = await prisma.referralPayout.findMany({
    where: { id: { in: payoutIds }, status: { in: ["APPROVED", "PENDING"] } },
  });

  // We need referrer paypal email — fetch in one go
  const referrerIds = Array.from(new Set(payouts.map((p) => p.referrerId)));
  const accounts = await prisma.paypalAccount.findMany({
    where: { memberId: { in: referrerIds } },
  });
  const acctMap = new Map(accounts.map((a) => [a.memberId, a]));

  const items = payouts
    .filter((p) => acctMap.has(p.referrerId))
    .map((p) => ({
      recipientEmail: acctMap.get(p.referrerId)!.paypalEmail,
      amountCents: p.amountCents,
      note: "Tee24 referral reward",
      senderItemId: p.id,
    }));

  if (items.length === 0) return { sent: 0, batchId: null };

  const batchId = `tee24-batch-${Date.now()}`;
  const batch = await paypalSendBatchPayout({ batchId, items });

  await prisma.referralPayout.updateMany({
    where: { id: { in: items.map((i) => i.senderItemId) } },
    data: { status: "SENT", paypalTxnId: batch.payoutBatchId, paidAt: new Date() },
  });

  void audit({
    actorId: opts?.actorId,
    action: "referral.payout-send",
    entityType: "ReferralPayoutBatch",
    entityId: batch.payoutBatchId,
    metadata: { count: items.length, totalCents: items.reduce((s, i) => s + i.amountCents, 0) },
  });

  void adminNotify({
    kind: "integration.recovered",
    severity: "INFO",
    title: `Referral payouts sent (${items.length})`,
    body: `Total: $${(items.reduce((s, i) => s + i.amountCents, 0) / 100).toFixed(2)}`,
    link: `/admin/franchise`,
  });

  return { sent: items.length, batchId: batch.payoutBatchId };
}

/**
 * Year-end 1099-NEC report: any referrer with ≥ $600 in PAYMENT-kind earnings
 * over the calendar year.
 */
export async function buildYearEnd1099Report(year: number) {
  const prisma = getPrisma();
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const payouts = await prisma.referralPayout.findMany({
    where: { status: { in: ["SENT", "PAID"] }, paidAt: { gte: start, lt: end } },
  });

  const totals = new Map<string, number>();
  for (const p of payouts) {
    totals.set(p.referrerId, (totals.get(p.referrerId) ?? 0) + p.amountCents);
  }

  const reportable = Array.from(totals.entries())
    .filter(([, cents]) => cents >= 60_000)
    .map(([referrerId, cents]) => ({ referrerId, totalCents: cents }));

  return { year, count: reportable.length, rows: reportable };
}
