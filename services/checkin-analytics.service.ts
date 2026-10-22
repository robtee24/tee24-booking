/**
 * Check-in analytics — location-level and member-level usage metrics derived
 * from Kisi check-ins (Visit rows, source = KISI).
 *
 * Everything is computed in the location's timezone so "day of week", "time of
 * day" and "today" line up with what staff see on the wall clock.
 *
 * Member base for usage metrics = members with status ACTIVE at the location.
 */
import { getPrisma } from "@/lib/db";
import { startOfDayInTz, dayKeyInTz } from "@/services/door.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TZ = "America/New_York";
const PLACEHOLDER_TYPES = new Set(["{membership_title}", "", "null", "undefined"]);

export type BlockHours = 1 | 2 | 3 | 4 | 6;
export const BLOCK_OPTIONS: BlockHours[] = [1, 2, 3, 4, 6];

export type TimeWindow = { start: number; end: number }; // local hours, 0–24; end <= start wraps past midnight

export type AnalyticsLocation = { id: string; name: string; slug: string; timezone: string };
export type MemberLite = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  membershipType: string | null;
  locationId: string;
  locationSlug: string;
  joinDate: string | null;
};

export type WeekdayStat = { dow: number; label: string; total: number; occurrences: number; avg: number };
export type BlockStat = { start: number; end: number; label: string; total: number; avg: number; share: number };
export type TopMember = { member: MemberLite; count: number; lastAt: string | null; perWeek: number };
export type MembershipTypeStat = {
  type: string;
  activeMembers: number;
  visitingMembers: number;
  checkIns: number;
  avgPerMember: number;
  avgPerVisitingMember: number;
  usageRate: number;
};
export type MemberWithout = MemberLite & { lastCheckInAt: string | null; daysSince: number | null };

export type LocationAnalytics = {
  location: AnalyticsLocation | null; // null = combined
  timezone: string;
  // Volume
  total: number;
  matched: number;
  unmatched: number;
  unmatchedShare: number;
  prevTotal: number;
  deltaPct: number | null;
  avgPerDay: number;
  prevAvgPerDay: number;
  peakDay: { day: string; total: number } | null;
  quietestDay: { day: string; total: number } | null;
  daily: Array<{ day: string; total: number }>;
  // Patterns
  byWeekday: WeekdayStat[];
  weekendShare: number;
  byBlock: BlockStat[];
  busiestBlock: BlockStat | null;
  byHour: number[]; // 24 totals
  heat: number[][]; // [dow][hour] totals
  window: {
    start: number;
    end: number;
    label: string;
    total: number;
    avgPerDay: number;
    share: number;
    byWeekday: WeekdayStat[];
    daily: Array<{ day: string; total: number }>;
  } | null;
  // Members
  activeMembers: number;
  visitingMembers: number;
  membersWithoutCheckIn: number;
  usageRate: number;
  avgPerActiveMember: number;
  avgPerVisitingMember: number;
  medianPerVisitingMember: number;
  avgVisitsPerWeekPerVisitingMember: number;
  inactive14d: number;
  frequency: Array<{ bucket: string; members: number }>;
  topMembers: TopMember[];
  byMembershipType: MembershipTypeStat[];
  membersWithout: MemberWithout[];
  avgUnlocksPerCheckIn: number;
};

export type CheckInAnalytics = {
  days: number;
  elapsedDays: number;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  blockHours: BlockHours;
  /** Earliest check-in on record (ISO) — deltas vs the previous period are only meaningful when this predates it. */
  dataSince: string | null;
  prevPeriodComplete: boolean;
  combined: LocationAnalytics;
  locations: LocationAnalytics[];
  crossLocationMembers: Array<{ member: MemberLite; counts: Record<string, number>; total: number }>;
};

type VisitRow = {
  id: string;
  enteredAt: Date;
  locationId: string;
  memberId: string | null;
  unlockCount: number;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function round(n: number, dp = 1) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
function hourLabel(h: number) {
  const hh = ((h % 24) + 24) % 24;
  if (hh === 0) return "12am";
  if (hh === 12) return "12pm";
  return hh < 12 ? `${hh}am` : `${hh - 12}pm`;
}
export function windowLabel(start: number, end: number) {
  return `${hourLabel(start)}–${end === 24 ? "12am" : hourLabel(end)}`;
}
function inWindow(hour: number, w: TimeWindow) {
  if (w.end > w.start) return hour >= w.start && hour < w.end;
  // wraps past midnight (e.g. 22 → 2)
  return hour >= w.start || hour < w.end;
}
function normalizeType(t: string | null | undefined) {
  const s = (t ?? "").trim();
  return PLACEHOLDER_TYPES.has(s) ? "Not set" : s;
}

/** Local (tz) weekday 0–6 and hour 0–23 for an instant. Cached formatter per tz. */
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function localParts(d: Date, tz: string): { dow: number; hour: number } {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", hourCycle: "h23" });
    fmtCache.set(tz, f);
  }
  const parts = f.formatToParts(d);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  return { dow: Math.max(0, WEEKDAY_LABELS.indexOf(wd)), hour };
}

function median(nums: number[]) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export async function getCheckInAnalytics(opts: {
  days?: number;
  locationIds?: string[];
  blockHours?: BlockHours;
  window?: TimeWindow | null;
  now?: Date;
}): Promise<CheckInAnalytics> {
  const prisma = getPrisma();
  const now = opts.now ?? new Date();
  const days = Math.min(Math.max(Math.round(opts.days ?? 30), 1), 365);
  const blockHours: BlockHours = BLOCK_OPTIONS.includes(opts.blockHours as BlockHours) ? (opts.blockHours as BlockHours) : 3;
  const win = opts.window && Number.isFinite(opts.window.start) && Number.isFinite(opts.window.end) ? opts.window : null;

  const locations: AnalyticsLocation[] = await prisma.location.findMany({
    where: { disabled: false, ...(opts.locationIds ? { id: { in: opts.locationIds } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true, timezone: true },
  });
  const locIds = locations.map((l) => l.id);
  const tzOf = new Map(locations.map((l) => [l.id, l.timezone || DEFAULT_TZ]));
  const slugOf = new Map(locations.map((l) => [l.id, l.slug]));
  const primaryTz = locations[0]?.timezone || DEFAULT_TZ;

  // Period = the last `days` calendar days including today (per the primary tz).
  const todayStart = startOfDayInTz(primaryTz, now);
  const periodStart = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
  const prevStart = new Date(periodStart.getTime() - days * DAY_MS);
  const elapsedDays = Math.max((now.getTime() - periodStart.getTime()) / DAY_MS, 1 / 24);

  const [visitsAll, members, earliest] = await Promise.all([
    prisma.visit.findMany({
      where: { source: "KISI", locationId: { in: locIds }, enteredAt: { gte: prevStart, lte: now } },
      select: { id: true, enteredAt: true, locationId: true, memberId: true, unlockCount: true },
      orderBy: { enteredAt: "asc" },
    }) as Promise<VisitRow[]>,
    prisma.member.findMany({
      where: { locationId: { in: locIds }, status: "ACTIVE" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        membershipType: true,
        locationId: true,
        joinDate: true,
        membershipStartDate: true,
      },
    }),
    prisma.visit.findFirst({ where: { source: "KISI", locationId: { in: locIds } }, orderBy: { enteredAt: "asc" }, select: { enteredAt: true } }),
  ]);

  const memberLite = new Map<string, MemberLite>();
  for (const m of members) {
    memberLite.set(m.id, {
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      email: m.email,
      membershipType: normalizeType(m.membershipType),
      locationId: m.locationId,
      locationSlug: slugOf.get(m.locationId) ?? "",
      joinDate: (m.joinDate ?? m.membershipStartDate)?.toISOString() ?? null,
    });
  }

  // Members referenced by visits but not ACTIVE (cancelled since, visitors…) — still shown in top lists.
  const missingIds = Array.from(new Set(visitsAll.map((v) => v.memberId).filter((id): id is string => !!id && !memberLite.has(id))));
  if (missingIds.length) {
    const extra = await prisma.member.findMany({
      where: { id: { in: missingIds } },
      select: { id: true, firstName: true, lastName: true, email: true, membershipType: true, locationId: true, joinDate: true, status: true },
    });
    for (const m of extra) {
      memberLite.set(m.id, {
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
        membershipType: `${normalizeType(m.membershipType)}${m.status !== "ACTIVE" ? ` (${m.status.toLowerCase()})` : ""}`,
        locationId: m.locationId,
        locationSlug: slugOf.get(m.locationId) ?? "",
        joinDate: m.joinDate?.toISOString() ?? null,
      });
    }
  }

  const periodVisits = visitsAll.filter((v) => v.enteredAt >= periodStart);
  const prevVisits = visitsAll.filter((v) => v.enteredAt < periodStart);

  // Last check-in (any time) for active members — used for "members without a check-in" and inactivity.
  const lastVisitByMember = new Map<string, Date>();
  const activeIds = members.map((m) => m.id);
  if (activeIds.length) {
    const grouped = await prisma.visit.groupBy({
      by: ["memberId"],
      where: { source: "KISI", memberId: { in: activeIds } },
      _max: { enteredAt: true },
    });
    for (const g of grouped) if (g.memberId && g._max.enteredAt) lastVisitByMember.set(g.memberId, g._max.enteredAt);
  }

  // Weekday occurrences across the period (calendar days incl. today).
  const weekdayOccurrences = new Array(7).fill(0) as number[];
  const periodDayKeys: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(periodStart.getTime() + i * DAY_MS + 12 * 60 * 60 * 1000);
    weekdayOccurrences[localParts(d, primaryTz).dow] += 1;
    periodDayKeys.push(dayKeyInTz(d, primaryTz));
  }

  function compute(loc: AnalyticsLocation | null): LocationAnalytics {
    const tz = loc ? tzOf.get(loc.id) ?? DEFAULT_TZ : primaryTz;
    const vis = loc ? periodVisits.filter((v) => v.locationId === loc.id) : periodVisits;
    const prev = loc ? prevVisits.filter((v) => v.locationId === loc.id) : prevVisits;
    const activeMembersList = loc ? members.filter((m) => m.locationId === loc.id) : members;

    const total = vis.length;
    const matched = vis.filter((v) => v.memberId).length;
    const unmatched = total - matched;
    const prevTotal = prev.length;

    // Daily series
    const dailyMap = new Map<string, number>(periodDayKeys.map((k) => [k, 0]));
    const byWeekdayTotals = new Array(7).fill(0) as number[];
    const byHour = new Array(24).fill(0) as number[];
    const heat: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
    const winDaily = new Map<string, number>(periodDayKeys.map((k) => [k, 0]));
    const winWeekday = new Array(7).fill(0) as number[];
    let winTotal = 0;
    let unlockSum = 0;
    const perMember = new Map<string, { count: number; lastAt: Date }>();

    for (const v of vis) {
      const { dow, hour } = localParts(v.enteredAt, tz);
      const key = dayKeyInTz(v.enteredAt, tz);
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
      byWeekdayTotals[dow] += 1;
      byHour[hour] += 1;
      heat[dow][hour] += 1;
      unlockSum += v.unlockCount || 1;
      if (win && inWindow(hour, win)) {
        winTotal += 1;
        winDaily.set(key, (winDaily.get(key) ?? 0) + 1);
        winWeekday[dow] += 1;
      }
      if (v.memberId) {
        const cur = perMember.get(v.memberId);
        if (!cur) perMember.set(v.memberId, { count: 1, lastAt: v.enteredAt });
        else {
          cur.count += 1;
          if (v.enteredAt > cur.lastAt) cur.lastAt = v.enteredAt;
        }
      }
    }

    const daily = periodDayKeys.map((day) => ({ day, total: dailyMap.get(day) ?? 0 }));
    const completeDays = daily.slice(0, -1); // exclude partial today for peak/quiet
    const peakSource = completeDays.length ? completeDays : daily;
    const peakDay = peakSource.length ? peakSource.reduce((a, b) => (b.total > a.total ? b : a)) : null;
    const quietestDay = peakSource.length ? peakSource.reduce((a, b) => (b.total < a.total ? b : a)) : null;

    const byWeekday: WeekdayStat[] = byWeekdayTotals.map((t, dow) => ({
      dow,
      label: WEEKDAY_LABELS[dow],
      total: t,
      occurrences: weekdayOccurrences[dow],
      avg: weekdayOccurrences[dow] ? round(t / weekdayOccurrences[dow]) : 0,
    }));
    // Mon-first ordering for display
    const byWeekdayMonFirst = [...byWeekday.slice(1), byWeekday[0]];
    const weekendTotal = byWeekdayTotals[0] + byWeekdayTotals[6];

    const nBlocks = 24 / blockHours;
    const byBlock: BlockStat[] = Array.from({ length: nBlocks }, (_, i) => {
      const start = i * blockHours;
      const end = start + blockHours;
      let t = 0;
      for (let h = start; h < end; h++) t += byHour[h];
      return { start, end, label: windowLabel(start, end), total: t, avg: round(t / elapsedDays), share: total ? round((t / total) * 100) : 0 };
    });
    const busiestBlock = byBlock.length ? byBlock.reduce((a, b) => (b.total > a.total ? b : a)) : null;

    // Member metrics (ACTIVE base)
    const activeCount = activeMembersList.length;
    const activeIdSet = new Set(activeMembersList.map((m) => m.id));
    let visitingActive = 0;
    const activeCounts: number[] = [];
    for (const m of activeMembersList) {
      const c = perMember.get(m.id)?.count ?? 0;
      activeCounts.push(c);
      if (c > 0) visitingActive += 1;
    }
    const matchedActiveCheckIns = activeCounts.reduce((a, b) => a + b, 0);
    const visitingCounts = activeCounts.filter((c) => c > 0);
    const weeks = elapsedDays / 7;

    const frequencyBuckets: Array<[string, (c: number) => boolean]> = [
      ["0", (c) => c === 0],
      ["1", (c) => c === 1],
      ["2–4", (c) => c >= 2 && c <= 4],
      ["5–9", (c) => c >= 5 && c <= 9],
      ["10–19", (c) => c >= 10 && c <= 19],
      ["20+", (c) => c >= 20],
    ];
    const frequency = frequencyBuckets.map(([bucket, test]) => ({ bucket, members: activeCounts.filter(test).length }));

    const cutoff14 = new Date(now.getTime() - 14 * DAY_MS);
    let inactive14d = 0;
    const membersWithout: MemberWithout[] = [];
    for (const m of activeMembersList) {
      const last = lastVisitByMember.get(m.id) ?? null;
      if (!last || last < cutoff14) inactive14d += 1;
      if (!perMember.has(m.id)) {
        const lite = memberLite.get(m.id)!;
        membersWithout.push({
          ...lite,
          lastCheckInAt: last ? last.toISOString() : null,
          daysSince: last ? Math.floor((now.getTime() - last.getTime()) / DAY_MS) : null,
        });
      }
    }
    membersWithout.sort((a, b) => {
      // Never checked in first (most concerning), then longest since last visit.
      if (a.daysSince == null && b.daysSince != null) return -1;
      if (a.daysSince != null && b.daysSince == null) return 1;
      return (b.daysSince ?? 0) - (a.daysSince ?? 0) || a.lastName.localeCompare(b.lastName);
    });

    const topMembers: TopMember[] = Array.from(perMember.entries())
      .sort((a, b) => b[1].count - a[1].count || b[1].lastAt.getTime() - a[1].lastAt.getTime())
      .slice(0, 15)
      .map(([id, s]) => ({
        member: memberLite.get(id) ?? {
          id,
          firstName: "Unknown",
          lastName: "member",
          email: null,
          membershipType: null,
          locationId: "",
          locationSlug: "",
          joinDate: null,
        },
        count: s.count,
        lastAt: s.lastAt.toISOString(),
        perWeek: round(s.count / weeks),
      }));

    // Membership type breakdown (ACTIVE base)
    const typeMap = new Map<string, { active: number; visiting: number; checkIns: number }>();
    for (const m of activeMembersList) {
      const t = memberLite.get(m.id)?.membershipType ?? "Not set";
      const cur = typeMap.get(t) ?? { active: 0, visiting: 0, checkIns: 0 };
      const c = perMember.get(m.id)?.count ?? 0;
      cur.active += 1;
      if (c > 0) cur.visiting += 1;
      cur.checkIns += c;
      typeMap.set(t, cur);
    }
    const byMembershipType: MembershipTypeStat[] = Array.from(typeMap.entries())
      .map(([type, s]) => ({
        type,
        activeMembers: s.active,
        visitingMembers: s.visiting,
        checkIns: s.checkIns,
        avgPerMember: s.active ? round(s.checkIns / s.active) : 0,
        avgPerVisitingMember: s.visiting ? round(s.checkIns / s.visiting) : 0,
        usageRate: s.active ? round((s.visiting / s.active) * 100) : 0,
      }))
      .sort((a, b) => b.checkIns - a.checkIns || b.activeMembers - a.activeMembers);

    const windowStats = win
      ? {
          start: win.start,
          end: win.end,
          label: windowLabel(win.start, win.end),
          total: winTotal,
          avgPerDay: round(winTotal / elapsedDays),
          share: total ? round((winTotal / total) * 100) : 0,
          byWeekday: (() => {
            const arr = winWeekday.map((t, dow) => ({
              dow,
              label: WEEKDAY_LABELS[dow],
              total: t,
              occurrences: weekdayOccurrences[dow],
              avg: weekdayOccurrences[dow] ? round(t / weekdayOccurrences[dow]) : 0,
            }));
            return [...arr.slice(1), arr[0]];
          })(),
          daily: periodDayKeys.map((day) => ({ day, total: winDaily.get(day) ?? 0 })),
        }
      : null;

    void activeIdSet;

    return {
      location: loc,
      timezone: tz,
      total,
      matched,
      unmatched,
      unmatchedShare: total ? round((unmatched / total) * 100) : 0,
      prevTotal,
      deltaPct: prevTotal ? round(((total - prevTotal) / prevTotal) * 100) : null,
      avgPerDay: round(total / elapsedDays),
      prevAvgPerDay: round(prevTotal / days),
      peakDay,
      quietestDay,
      daily,
      byWeekday: byWeekdayMonFirst,
      weekendShare: total ? round((weekendTotal / total) * 100) : 0,
      byBlock,
      busiestBlock,
      byHour,
      heat,
      window: windowStats,
      activeMembers: activeCount,
      visitingMembers: visitingActive,
      membersWithoutCheckIn: activeCount - visitingActive,
      usageRate: activeCount ? round((visitingActive / activeCount) * 100) : 0,
      avgPerActiveMember: activeCount ? round(matchedActiveCheckIns / activeCount) : 0,
      avgPerVisitingMember: visitingActive ? round(matchedActiveCheckIns / visitingActive) : 0,
      medianPerVisitingMember: round(median(visitingCounts)),
      avgVisitsPerWeekPerVisitingMember: visitingActive ? round(matchedActiveCheckIns / visitingActive / weeks) : 0,
      inactive14d,
      frequency,
      topMembers,
      byMembershipType,
      membersWithout: membersWithout.slice(0, 500),
      avgUnlocksPerCheckIn: total ? round(unlockSum / total, 2) : 0,
    };
  }

  const perLocation = locations.map((l) => compute(l));
  const combined = compute(null);

  // Members who used more than one location this period.
  const cross = new Map<string, Record<string, number>>();
  for (const v of periodVisits) {
    if (!v.memberId) continue;
    const rec = cross.get(v.memberId) ?? {};
    rec[v.locationId] = (rec[v.locationId] ?? 0) + 1;
    cross.set(v.memberId, rec);
  }
  const crossLocationMembers = Array.from(cross.entries())
    .filter(([, counts]) => Object.keys(counts).length > 1)
    .map(([id, counts]) => ({
      member: memberLite.get(id)!,
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    }))
    .filter((r) => r.member)
    .sort((a, b) => b.total - a.total)
    .slice(0, 50);

  return {
    days,
    elapsedDays: round(elapsedDays, 2),
    periodStart: periodStart.toISOString(),
    periodEnd: now.toISOString(),
    generatedAt: now.toISOString(),
    blockHours,
    dataSince: earliest?.enteredAt.toISOString() ?? null,
    prevPeriodComplete: !!earliest && earliest.enteredAt <= prevStart,
    combined,
    locations: perLocation,
    crossLocationMembers,
  };
}
