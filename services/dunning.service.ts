/**
 * Dunning — retries for failed payments, late fees, overdue + upcoming reminders,
 * card expiry notices.
 *
 * Retry schedule comes from `Location.dunningRetryDays` (default [1, 3, 7]):
 *   attempt 1 = the original charge; attempt k+1 happens `rules[k-1]` days after
 *   the previous failure. After the final retry fails we apply the late fee
 *   (once) and emit `payment.overdue`. Invoices with no card on file go
 *   PAST_DUE the day after their due date and also emit `payment.overdue`.
 *
 * Cron jobs:
 *   retry-failed-payments        hourly
 *   upcoming-payment-reminders   daily  (payment.upcoming 3 days ahead, card.expiring / card.expired)
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emitMemberEvent } from "@/lib/events";
import { isSquareConfigured } from "@/lib/square";
import {
  addInvoiceLine,
  chargeInvoiceWithDefaultCard,
  invoiceRemainingCents,
  parseDunningRetryDays,
  publicPayUrl,
} from "./billing.service";
import { previewNextInvoiceCents } from "./recurring-billing.service";
import type { Location } from "@prisma/client";

export const LATE_FEE_LINE = "Late fee";
export const UPCOMING_REMINDER_DAYS = 3;

/** When the next automatic retry should run after `attemptCount` attempts (null = no more retries). */
export function nextRetryAtFor(location: Pick<Location, "dunningRetryDays">, attemptCount: number, from = new Date()): Date | null {
  const rules = parseDunningRetryDays(location.dunningRetryDays);
  const idx = attemptCount - 1; // attempt 1 → rules[0]
  if (idx < 0 || idx >= rules.length) return null;
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + rules[idx]);
  return d;
}

export function maxAttemptsFor(location: Pick<Location, "dunningRetryDays">): number {
  return parseDunningRetryDays(location.dunningRetryDays).length + 1;
}

async function hasDefaultCard(memberId: string): Promise<boolean> {
  if (!isSquareConfigured()) return false;
  const pm = await getPrisma().paymentMethod.findFirst({ where: { memberId, status: { not: "EXPIRED" }, squareCardId: { not: null } }, select: { id: true } });
  return Boolean(pm);
}

/**
 * Final-failure handling: late fee (once) + payment.overdue event. Idempotent —
 * checks for an existing late-fee line and uses `nextRetryAt = null` as the
 * "already finalised" marker.
 */
export async function finalizeOverdueInvoice(invoiceId: string, opts?: { reason?: string }) {
  const prisma = getPrisma();
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { lineItems: true, location: true, member: { select: { firstName: true } } },
  });
  if (!inv) return;
  if (!["PAST_DUE", "FAILED", "SCHEDULED"].includes(inv.status)) return;

  const hasLateFee = inv.lineItems.some((l) => l.description === LATE_FEE_LINE);
  if (inv.location.lateFeeCents > 0 && !hasLateFee) {
    await addInvoiceLine(invoiceId, { description: LATE_FEE_LINE, unitCents: inv.location.lateFeeCents });
  }
  const token = inv.payToken ?? (await (await import("./billing.service")).ensurePayToken(invoiceId));
  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "PAST_DUE", nextRetryAt: null, lastFailureReason: opts?.reason ?? inv.lastFailureReason ?? undefined },
  });

  void audit({
    organizationId: inv.organizationId,
    action: "billing.invoice-edit",
    entityType: "Invoice",
    entityId: invoiceId,
    metadata: { dunning: "finalized", lateFeeCents: !hasLateFee ? inv.location.lateFeeCents : 0, reason: opts?.reason },
  });

  await emitMemberEvent("payment.overdue", {
    memberId: inv.memberId,
    locationId: inv.locationId,
    organizationId: inv.organizationId,
    refs: { invoiceId: inv.id, subscriptionId: inv.subscriptionId ?? undefined },
    vars: {
      amount: (invoiceRemainingCents(updated) / 100).toFixed(2),
      invoiceNumber: inv.number,
      dueDate: inv.dueDate.toISOString().slice(0, 10),
      reason: opts?.reason ?? inv.lastFailureReason ?? null,
      lateFee: !hasLateFee && inv.location.lateFeeCents > 0 ? (inv.location.lateFeeCents / 100).toFixed(2) : null,
      payUrl: publicPayUrl(token),
      firstName: inv.member.firstName,
    },
  });
}

export type DunningResult = {
  retried: number;
  recovered: number;
  stillFailing: number;
  finalized: number;
  markedOverdue: number;
};

/** Hourly: retry due invoices, mark unpaid-past-due invoices overdue. */
export async function retryFailedPayments(now = new Date()): Promise<DunningResult> {
  const prisma = getPrisma();
  const result: DunningResult = { retried: 0, recovered: 0, stillFailing: 0, finalized: 0, markedOverdue: 0 };

  // 1) Scheduled retries
  const due = await prisma.invoice.findMany({
    where: { status: { in: ["PAST_DUE", "FAILED"] }, nextRetryAt: { lte: now } },
    include: { location: true },
    take: 200,
  });
  for (const inv of due) {
    if (!(await hasDefaultCard(inv.memberId))) {
      await finalizeOverdueInvoice(inv.id, { reason: inv.lastFailureReason ?? "No card on file" });
      result.finalized++;
      continue;
    }
    result.retried++;
    try {
      await chargeInvoiceWithDefaultCard(inv.id);
      result.recovered++;
    } catch {
      result.stillFailing++;
      const after = await prisma.invoice.findUnique({ where: { id: inv.id }, select: { nextRetryAt: true, status: true } });
      if (after && after.status === "PAST_DUE" && !after.nextRetryAt) {
        await finalizeOverdueInvoice(inv.id);
        result.finalized++;
      }
    }
  }

  // 2) Scheduled invoices whose due date has passed with no payment
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const unpaid = await prisma.invoice.findMany({
    where: { status: "SCHEDULED", dueDate: { lt: dayAgo }, totalCents: { gt: 0 } },
    include: { location: true },
    take: 200,
  });
  for (const inv of unpaid) {
    if (await hasDefaultCard(inv.memberId)) {
      // A card was added after the invoice was generated — try it now.
      result.retried++;
      try {
        await chargeInvoiceWithDefaultCard(inv.id);
        result.recovered++;
        continue;
      } catch {
        result.stillFailing++;
        continue; // onInvoiceChargeFailed scheduled the retry
      }
    }
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: "PAST_DUE", lastFailureReason: "No card on file", attemptCount: inv.attemptCount } });
    const rules = parseDunningRetryDays(inv.location.dunningRetryDays);
    const graceEnd = new Date(inv.dueDate.getTime() + rules[rules.length - 1] * 86_400_000);
    if (now >= graceEnd) {
      await finalizeOverdueInvoice(inv.id, { reason: "No card on file" });
      result.finalized++;
    } else {
      await prisma.invoice.update({ where: { id: inv.id }, data: { nextRetryAt: graceEnd } });
      await emitMemberEvent("payment.overdue", {
        memberId: inv.memberId,
        locationId: inv.locationId,
        organizationId: inv.organizationId,
        refs: { invoiceId: inv.id, subscriptionId: inv.subscriptionId ?? undefined },
        vars: {
          amount: (invoiceRemainingCents(inv) / 100).toFixed(2),
          invoiceNumber: inv.number,
          dueDate: inv.dueDate.toISOString().slice(0, 10),
          reason: "No card on file",
          payUrl: inv.payToken ? publicPayUrl(inv.payToken) : null,
        },
      });
    }
    result.markedOverdue++;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

function utcDayWindow(base: Date, daysAhead: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + daysAhead));
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

/** Daily: `payment.upcoming` for charges happening in 3 days + card expiry notices. */
export async function sendUpcomingPaymentReminders(now = new Date()) {
  const prisma = getPrisma();
  const { start, end } = utcDayWindow(now, UPCOMING_REMINDER_DAYS);
  let upcoming = 0;

  const subs = await prisma.membershipSubscription.findMany({
    where: { status: "ACTIVE", autoRenew: true, priceCents: { gt: 0 }, nextInvoiceDate: { gte: start, lt: end } },
    include: { plan: { select: { name: true } }, location: { select: { taxRateBps: true } }, member: { select: { organizationId: true, firstName: true } } },
    take: 1000,
  });
  for (const s of subs) {
    const amountCents = await previewNextInvoiceCents({ memberId: s.memberId, planId: s.planId, priceCents: s.priceCents, locationTaxRateBps: s.location.taxRateBps });
    const card = await prisma.paymentMethod.findFirst({ where: { memberId: s.memberId, isDefault: true }, select: { brand: true, last4: true } });
    await emitMemberEvent("payment.upcoming", {
      memberId: s.memberId,
      locationId: s.locationId,
      organizationId: s.member.organizationId,
      refs: { subscriptionId: s.id },
      vars: {
        amount: (amountCents / 100).toFixed(2),
        planName: s.plan.name,
        chargeDate: s.nextInvoiceDate?.toISOString().slice(0, 10) ?? null,
        card: card ? `${card.brand} •••• ${card.last4}` : null,
        firstName: s.member.firstName,
      },
    });
    upcoming++;
  }

  // One-off scheduled invoices (no subscription) due in 3 days
  const invoices = await prisma.invoice.findMany({
    where: { status: "SCHEDULED", subscriptionId: null, totalCents: { gt: 0 }, dueDate: { gte: start, lt: end } },
    include: { member: { select: { organizationId: true, firstName: true } } },
    take: 1000,
  });
  for (const inv of invoices) {
    await emitMemberEvent("payment.upcoming", {
      memberId: inv.memberId,
      locationId: inv.locationId,
      organizationId: inv.organizationId,
      refs: { invoiceId: inv.id },
      vars: {
        amount: (invoiceRemainingCents(inv) / 100).toFixed(2),
        invoiceNumber: inv.number,
        chargeDate: inv.dueDate.toISOString().slice(0, 10),
        payUrl: inv.payToken ? publicPayUrl(inv.payToken) : null,
        firstName: inv.member.firstName,
      },
    });
    upcoming++;
  }

  const cards = await checkCardExpiry(now);
  return { upcoming, ...cards };
}

/**
 * Cards are valid through the last day of `expMonth`. On the 1st of the expiry
 * month we emit `card.expiring`; on the 1st of the following month we flip the
 * row to EXPIRED and emit `card.expired`. Running daily is idempotent because
 * both checks key off "today is the 1st".
 */
export async function checkCardExpiry(now = new Date(), opts?: { force?: boolean }) {
  const prisma = getPrisma();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1-12
  let expiring = 0;
  let expired = 0;

  // Expired: any ACTIVE/FAILING card whose expiry month is before this month
  const expiredCards = await prisma.paymentMethod.findMany({
    where: { status: { not: "EXPIRED" }, OR: [{ expYear: { lt: y } }, { expYear: y, expMonth: { lt: m } }] },
    include: { member: { select: { id: true, locationId: true, organizationId: true, firstName: true } } },
  });
  for (const pm of expiredCards) {
    await prisma.paymentMethod.update({ where: { id: pm.id }, data: { status: "EXPIRED" } });
    await emitMemberEvent("card.expired", {
      memberId: pm.memberId,
      locationId: pm.member.locationId,
      organizationId: pm.member.organizationId,
      vars: { card: `${pm.brand} •••• ${pm.last4}`, expMonth: pm.expMonth, expYear: pm.expYear, firstName: pm.member.firstName },
    });
    expired++;
  }

  if (now.getUTCDate() === 1 || opts?.force) {
    const expiringCards = await prisma.paymentMethod.findMany({
      where: { status: { not: "EXPIRED" }, expYear: y, expMonth: m },
      include: { member: { select: { id: true, locationId: true, organizationId: true, firstName: true } } },
    });
    for (const pm of expiringCards) {
      await emitMemberEvent("card.expiring", {
        memberId: pm.memberId,
        locationId: pm.member.locationId,
        organizationId: pm.member.organizationId,
        vars: { card: `${pm.brand} •••• ${pm.last4}`, expMonth: pm.expMonth, expYear: pm.expYear, firstName: pm.member.firstName },
      });
      expiring++;
    }
  }

  return { expiring, expired };
}
