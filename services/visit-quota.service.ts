/**
 * Visit-quota enforcement for limited plans (see lib/visit-quota.ts for modes).
 *
 * Runs after every Kisi event sync (every 5 minutes) and from its own cron, and
 * only looks at members on plans with `visitsPerPeriod`:
 *
 *  1. The first time a member's remaining count hits zero in a period, send the
 *     "visit.quota-reached" message (once per period — bookmarked on the
 *     subscription as `quotaNotifiedPeriodStart`).
 *  2. In enforce mode, reconcile Kisi: members whose last allowed day is over
 *     come out of the door group; members whose period rolled over go back in.
 *     Both go through AccessSync, so they're audit-logged and visible on the
 *     member profile ("Visit limit reached for this period").
 *
 * Nothing happens while MIGRATION_FREEZE is on — GymDesk still owns Kisi and
 * members shouldn't hear from two systems.
 */
import { getPrisma } from "@/lib/db";
import { emitMemberEvent } from "@/lib/events";
import { isMigrationFrozen } from "@/lib/migration-freeze";
import { visitQuotaMode } from "@/lib/visit-quota";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";
import { getVisitAllowance } from "@/services/visit-allowance.service";

export type QuotaRunResult = { mode: string; scanned: number; notified: number; revoked: number; restored: number; skipped?: string };

const ACTIVE_STATUSES = ["ACTIVE", "CANCEL_SCHEDULED", "COMP"];

export async function enforceVisitQuotas(now = new Date()): Promise<QuotaRunResult> {
  const mode = visitQuotaMode();
  const result: QuotaRunResult = { mode, scanned: 0, notified: 0, revoked: 0, restored: 0 };
  if (mode === "off") return { ...result, skipped: "VISIT_QUOTA_MODE=off" };
  if (isMigrationFrozen()) return { ...result, skipped: "MIGRATION_FREEZE is on" };

  const prisma = getPrisma();
  const subs = await prisma.membershipSubscription.findMany({
    where: { status: { in: ACTIVE_STATUSES }, plan: { visitsPerPeriod: { not: null } } },
    select: {
      id: true,
      memberId: true,
      quotaNotifiedPeriodStart: true,
      plan: { select: { name: true, visitsPerPeriod: true } },
      member: { select: { id: true, firstName: true, status: true, kisiAccessEnabled: true, kisiAccessReason: true, locationId: true, organizationId: true, location: { select: { timezone: true, name: true } } } },
    },
    take: 2000,
  });

  const seen = new Set<string>();
  for (const sub of subs) {
    if (seen.has(sub.memberId)) continue; // one pass per member even with overlapping subs
    seen.add(sub.memberId);
    if (sub.member.status === "CANCELLED") continue;
    result.scanned++;

    let allowance;
    try {
      allowance = await getVisitAllowance(sub.memberId, { timezone: sub.member.location.timezone, now });
    } catch (e) {
      console.warn("[visit-quota] allowance failed", sub.memberId, e);
      continue;
    }
    if (allowance.unlimited || allowance.limit == null || !allowance.periodStart) continue;

    // 1. One heads-up per period when the last visit is used.
    const periodStart = new Date(allowance.periodStart);
    const alreadyTold = sub.quotaNotifiedPeriodStart && sub.quotaNotifiedPeriodStart.getTime() === periodStart.getTime();
    if (allowance.remaining === 0 && !alreadyTold) {
      const tz = sub.member.location.timezone;
      const nextDate = allowance.periodEnd ? new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(allowance.periodEnd)) : "";
      await prisma.membershipSubscription.update({ where: { id: sub.id }, data: { quotaNotifiedPeriodStart: periodStart } });
      await emitMemberEvent("visit.quota-reached", {
        memberId: sub.memberId,
        locationId: sub.member.locationId,
        organizationId: sub.member.organizationId,
        refs: { subscriptionId: sub.id },
        vars: {
          firstName: sub.member.firstName,
          planName: sub.plan.name,
          visitsLimit: allowance.limit,
          periodLabel: allowance.periodLabel ?? "",
          nextVisitDate: nextDate,
          dueDate: nextDate,
          locationName: sub.member.location.name,
          enforced: mode === "enforce" ? "yes" : "no",
        },
      });
      result.notified++;
    }

    // 2. Enforce mode: keep Kisi in step with the allowance (both directions).
    if (mode !== "enforce") continue;
    const quotaBlocked = allowance.blockedCode === "QUOTA_EXCEEDED";
    const currentlyQuotaRevoked = !sub.member.kisiAccessEnabled && (sub.member.kisiAccessReason ?? "").startsWith("Visit limit reached");
    if (quotaBlocked === currentlyQuotaRevoked) continue; // already in the right state
    try {
      const desired = await computeDesiredAccessState(sub.memberId);
      await applyAccessState(sub.memberId, desired);
      if (desired.enabled) result.restored++;
      else if (desired.reason === "visit_quota") result.revoked++;
    } catch (e) {
      console.warn("[visit-quota] access update failed", sub.memberId, e);
    }
  }
  return result;
}
