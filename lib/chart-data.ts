/**
 * Server-side helpers that build chart-ready datasets from Prisma queries.
 * Keep these pure and cheap — they're invoked from page server components.
 */
import { getPrisma } from "@/lib/db";

/** Last N days as ISO strings (YYYY-MM-DD), oldest first. */
export function lastNDays(n: number, end: Date = new Date()): string[] {
  const out: string[] = [];
  const d = new Date(end);
  d.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

/** Last N months as { iso: 'YYYY-MM', label: 'MMM YY' }, oldest first. */
export function lastNMonths(n: number, end: Date = new Date()) {
  const out: { iso: string; label: string; start: Date; end: Date }[] = [];
  const d = new Date(end.getFullYear(), end.getMonth(), 1);
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(d);
    start.setMonth(d.getMonth() - i);
    const monthEnd = new Date(start);
    monthEnd.setMonth(start.getMonth() + 1);
    out.push({
      iso: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      label: start.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
      start,
      end: monthEnd,
    });
  }
  return out;
}

/**
 * Daily visit count for a location over the last `days` days.
 * Returns rows shaped for charting: { date, label, visits }.
 */
export async function visitsByDay(opts: { locationId: string; days: number }) {
  const days = lastNDays(opts.days);
  const start = new Date(days[0] + "T00:00:00");
  const visits = await getPrisma().visit.findMany({
    where: { locationId: opts.locationId, enteredAt: { gte: start } },
    select: { enteredAt: true },
  });
  const counts = new Map<string, number>();
  for (const d of days) counts.set(d, 0);
  for (const v of visits) {
    const k = v.enteredAt.toISOString().slice(0, 10);
    if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return days.map((d) => ({
    date: d,
    label: new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    visits: counts.get(d) ?? 0,
  }));
}

/** Today's visits bucketed into hourly slots (00..23). */
export async function visitsHourly(opts: { locationId: string; date?: Date }) {
  const day = opts.date ?? new Date();
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  const visits = await getPrisma().visit.findMany({
    where: { locationId: opts.locationId, enteredAt: { gte: start, lt: end } },
    select: { enteredAt: true },
  });
  const buckets = Array.from({ length: 24 }, (_, h) => ({
    hour: `${h.toString().padStart(2, "0")}:00`,
    visits: 0,
  }));
  for (const v of visits) {
    buckets[v.enteredAt.getHours()].visits++;
  }
  return buckets;
}

/** Member status counts → donut-ready slices. */
export async function memberStatusBreakdown(opts: { locationId: string }) {
  const rows = await getPrisma().member.groupBy({
    by: ["status"],
    where: { locationId: opts.locationId },
    _count: { _all: true },
  });
  return rows.map((r) => ({ name: String(r.status), value: r._count._all }));
}

/** Monthly revenue (paid charges) over the last N months. */
export async function revenueByMonth(opts: { locationId: string; months: number }) {
  const months = lastNMonths(opts.months);
  const start = months[0].start;
  const charges = await getPrisma().charge.findMany({
    where: {
      locationId: opts.locationId,
      status: "SUCCEEDED",
      createdAt: { gte: start },
    },
    select: { amountCents: true, createdAt: true },
  });
  const byKey = new Map<string, number>();
  for (const m of months) byKey.set(m.iso, 0);
  for (const c of charges) {
    const k = `${c.createdAt.getFullYear()}-${String(c.createdAt.getMonth() + 1).padStart(2, "0")}`;
    if (byKey.has(k)) byKey.set(k, (byKey.get(k) ?? 0) + c.amountCents);
  }
  return months.map((m) => ({
    month: m.label,
    revenue: Math.round((byKey.get(m.iso) ?? 0) / 100),
  }));
}

/** Member growth by month (cumulative active members). */
export async function memberGrowth(opts: { locationId: string; months: number }) {
  const months = lastNMonths(opts.months);
  const earliestEnd = months[months.length - 1].end;
  const members = await getPrisma().member.findMany({
    where: { locationId: opts.locationId, createdAt: { lt: earliestEnd } },
    select: { createdAt: true, status: true },
  });
  return months.map((m) => {
    let active = 0;
    let visitor = 0;
    for (const mem of members) {
      if (mem.createdAt >= m.end) continue;
      // count if they exist by the end of this month
      if (mem.status === "VISITOR") visitor++;
      else active++;
    }
    return { month: m.label, active, visitor };
  });
}

/** Subscription counts grouped by plan name. */
export async function subscriptionsByPlan(opts: { locationId: string }) {
  const subs = await getPrisma().membershipSubscription.findMany({
    where: { locationId: opts.locationId, status: { in: ["ACTIVE", "FROZEN"] } },
    select: { plan: { select: { name: true } } },
  });
  const byPlan = new Map<string, number>();
  for (const s of subs) {
    const k = s.plan?.name ?? "(none)";
    byPlan.set(k, (byPlan.get(k) ?? 0) + 1);
  }
  return Array.from(byPlan.entries()).map(([name, value]) => ({ name, value }));
}

/** Subscription status counts over the last N months. */
export async function subscriptionStatusOverTime(opts: { locationId: string; months: number }) {
  const months = lastNMonths(opts.months);
  const start = months[0].start;
  const subs = await getPrisma().membershipSubscription.findMany({
    where: { locationId: opts.locationId, createdAt: { gte: start } },
    select: { status: true, createdAt: true, cancelledAt: true, freezeStartDate: true },
  });
  return months.map((m) => {
    let active = 0;
    let frozen = 0;
    let cancelled = 0;
    for (const s of subs) {
      if (s.createdAt >= m.end) continue;
      if (s.cancelledAt && s.cancelledAt < m.end) cancelled++;
      else if (s.freezeStartDate && s.freezeStartDate < m.end) frozen++;
      else active++;
    }
    return { month: m.label, active, frozen, cancelled };
  });
}

/** Visit count distribution: how many members visited 1×, 2×, 3+× this month. */
export async function visitFrequencyDistribution(opts: { locationId: string }) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const visits = await getPrisma().visit.groupBy({
    by: ["memberId"],
    where: { locationId: opts.locationId, enteredAt: { gte: monthStart }, memberId: { not: null } },
    _count: { _all: true },
  });
  const buckets = [
    { range: "1 visit", min: 1, max: 1, members: 0 },
    { range: "2-3", min: 2, max: 3, members: 0 },
    { range: "4-7", min: 4, max: 7, members: 0 },
    { range: "8-15", min: 8, max: 15, members: 0 },
    { range: "16+", min: 16, max: Infinity, members: 0 },
  ];
  for (const v of visits) {
    const c = v._count._all;
    const b = buckets.find((b) => c >= b.min && c <= b.max);
    if (b) b.members++;
  }
  return buckets.map(({ range, members }) => ({ range, members }));
}

/** Top N most-visited members for a location this month. */
export async function topMembersByVisits(opts: { locationId: string; limit: number }) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const grouped = await getPrisma().visit.groupBy({
    by: ["memberId"],
    where: { locationId: opts.locationId, enteredAt: { gte: monthStart }, memberId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { memberId: "desc" } },
    take: opts.limit,
  });
  if (grouped.length === 0) return [];
  const memberIds = grouped.map((g) => g.memberId!).filter(Boolean);
  const members = await getPrisma().member.findMany({
    where: { id: { in: memberIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  return grouped
    .map((g) => {
      const m = byId.get(g.memberId!);
      return m ? { name: `${m.firstName} ${m.lastName}`, visits: g._count._all } : null;
    })
    .filter((x): x is { name: string; visits: number } => Boolean(x));
}

/** Visitor → Member conversion funnel for the trailing N days. */
export async function visitorFunnel(opts: { locationId: string; days: number }) {
  const start = new Date();
  start.setDate(start.getDate() - opts.days);
  const [leads, engaged, converted] = await Promise.all([
    getPrisma().visitor.count({ where: { locationId: opts.locationId, createdAt: { gte: start } } }),
    getPrisma().visitor.count({
      where: {
        locationId: opts.locationId,
        createdAt: { gte: start },
        stage: { in: ["ENGAGED", "CONVERTED"] },
      },
    }),
    getPrisma().visitor.count({
      where: { locationId: opts.locationId, createdAt: { gte: start }, stage: "CONVERTED" },
    }),
  ]);
  return [
    { label: "Leads captured", value: leads },
    { label: "Engaged", value: engaged },
    { label: "Converted to member", value: converted },
  ];
}
