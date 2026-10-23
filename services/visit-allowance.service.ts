/**
 * Plan visit allowances for the member app.
 *
 * Rules (per the Noonan plan: "3 visits per month"):
 *  - The period is *rolling from the member's signup day*, not the calendar
 *    month. If the subscription started on the 17th, periods run 17th → 16th.
 *  - A "visit" is a distinct calendar day (in the facility's timezone) with at
 *    least one check-in. Several unlocks on one day count once.
 *  - A day that already has a visit never blocks further unlocks that day.
 *  - Plans with `visitsPerPeriod = null` are unlimited.
 */
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { getPrisma } from "@/lib/db";

export type VisitAllowance = {
  unlimited: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  periodStart: string | null; // ISO
  periodEnd: string | null; // ISO (exclusive)
  periodLabel: string | null; // "Oct 17 – Nov 16"
  todayCounted: boolean;
  visitDays: string[]; // YYYY-MM-DD in facility tz, within period
  planName: string | null;
  subscriptionStatus: string | null;
  canUnlock: boolean;
  blockedReason: string | null;
  blockedCode: "NO_MEMBERSHIP" | "FROZEN" | "PENDING" | "QUOTA_EXCEEDED" | null;
};

const ACTIVE_STATUSES = ["ACTIVE", "CANCEL_SCHEDULED", "COMP"];

function ymd(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function daysInMonth(y: number, m0: number) {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** Local-midnight instant for (y, m0, d) in tz. */
function localMidnight(y: number, m0: number, d: number, tz: string): Date {
  const clampDay = Math.min(d, daysInMonth(y, m0));
  const iso = `${y}-${String(m0 + 1).padStart(2, "0")}-${String(clampDay).padStart(2, "0")}T00:00:00`;
  return fromZonedTime(iso, tz);
}

/** Current rolling period anchored to `anchor`'s local day-of-month. */
export function rollingMonthPeriod(anchor: Date, now: Date, tz: string): { start: Date; end: Date } {
  const anchorLocal = toZonedTime(anchor, tz);
  const anchorDay = anchorLocal.getDate();
  const nowLocal = toZonedTime(now, tz);
  let y = nowLocal.getFullYear();
  let m = nowLocal.getMonth();
  // Candidate start this month; if it's in the future, step back one month.
  let start = localMidnight(y, m, anchorDay, tz);
  if (start > now) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    start = localMidnight(y, m, anchorDay, tz);
  }
  let ey = y;
  let em = m + 1;
  if (em > 11) {
    em = 0;
    ey += 1;
  }
  const end = localMidnight(ey, em, anchorDay, tz);
  return { start, end };
}

export function rollingWeekPeriod(anchor: Date, now: Date, tz: string): { start: Date; end: Date } {
  const anchorLocal = toZonedTime(anchor, tz);
  const nowLocal = toZonedTime(now, tz);
  const diffDays = Math.floor((Date.UTC(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate()) - Date.UTC(anchorLocal.getFullYear(), anchorLocal.getMonth(), anchorLocal.getDate())) / 86_400_000);
  const periodsElapsed = Math.max(0, Math.floor(diffDays / 7));
  const startLocal = new Date(Date.UTC(anchorLocal.getFullYear(), anchorLocal.getMonth(), anchorLocal.getDate() + periodsElapsed * 7));
  const endLocal = new Date(startLocal.getTime() + 7 * 86_400_000);
  const toInstant = (d: Date) => fromZonedTime(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T00:00:00`, tz);
  return { start: toInstant(startLocal), end: toInstant(endLocal) };
}

function label(start: Date, end: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" });
  const lastDay = new Date(end.getTime() - 1);
  return `${fmt.format(start)} – ${fmt.format(lastDay)}`;
}

export async function getVisitAllowance(memberId: string, opts: { timezone?: string; now?: Date } = {}): Promise<VisitAllowance> {
  const prisma = getPrisma();
  const now = opts.now ?? new Date();
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { joinDate: true, membershipStartDate: true, createdAt: true, status: true, location: { select: { timezone: true } } },
  });
  const tz = opts.timezone ?? member?.location.timezone ?? "America/New_York";

  const sub = await prisma.membershipSubscription.findFirst({
    where: { memberId, status: { in: [...ACTIVE_STATUSES, "FROZEN", "PENDING"] } },
    include: { plan: { select: { name: true, visitsPerPeriod: true, visitPeriod: true } } },
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
  });

  const base: VisitAllowance = {
    unlimited: true,
    limit: null,
    used: 0,
    remaining: null,
    periodStart: null,
    periodEnd: null,
    periodLabel: null,
    todayCounted: false,
    visitDays: [],
    planName: sub?.plan.name ?? null,
    subscriptionStatus: sub?.status ?? null,
    canUnlock: true,
    blockedReason: null,
    blockedCode: null,
  };

  if (!sub) {
    // Legacy/imported members may have a status but no subscription row.
    if (member?.status === "ACTIVE") return base;
    return { ...base, canUnlock: false, blockedCode: "NO_MEMBERSHIP", blockedReason: "You don't have an active membership." };
  }
  if (sub.status === "FROZEN") return { ...base, canUnlock: false, blockedCode: "FROZEN", blockedReason: "Your membership is frozen. Contact us to resume it." };
  if (sub.status === "PENDING") return { ...base, canUnlock: false, blockedCode: "PENDING", blockedReason: "Your membership is still pending activation." };

  const limit = sub.plan.visitsPerPeriod;
  if (limit == null) return base;

  const anchor = sub.startDate ?? member?.membershipStartDate ?? member?.joinDate ?? member?.createdAt ?? now;
  const period = sub.plan.visitPeriod === "ROLLING_WEEK" ? rollingWeekPeriod(anchor, now, tz) : rollingMonthPeriod(anchor, now, tz);

  const visits = await prisma.visit.findMany({
    where: { memberId, enteredAt: { gte: period.start, lt: period.end } },
    select: { enteredAt: true },
  });
  const days = Array.from(new Set(visits.map((v) => ymd(v.enteredAt, tz)))).sort();
  const today = ymd(now, tz);
  const todayCounted = days.includes(today);
  const used = days.length;
  const remaining = Math.max(0, limit - used);
  const canUnlock = todayCounted || remaining > 0;

  return {
    unlimited: false,
    limit,
    used,
    remaining,
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    periodLabel: label(period.start, period.end, tz),
    todayCounted,
    visitDays: days,
    planName: sub.plan.name,
    subscriptionStatus: sub.status,
    canUnlock,
    blockedCode: canUnlock ? null : "QUOTA_EXCEEDED",
    blockedReason: canUnlock
      ? null
      : `You've used all ${limit} visits for this period (${label(period.start, period.end, tz)}). Your next visit unlocks ${new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(period.end)}.`,
  };
}
