import { Card, CardHeader, EmptyState, StatusBadge } from "@/components/ui";
import { AreaChart, BarChart, Heatmap, KpiCard } from "@/components/ui/charts";
import { getCurrentMember } from "@/lib/member-session";
import { getPrisma } from "@/lib/db";
import { Activity } from "lucide-react";
import { lastNMonths } from "@/lib/chart-data";

export const dynamic = "force-dynamic";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function PortalAttendance() {
  const member = await getCurrentMember();
  if (!member) return null;
  const prisma = getPrisma();

  const yearAgo = new Date();
  yearAgo.setDate(yearAgo.getDate() - 365);

  const [visits, latestTier, allYearVisits] = await Promise.all([
    prisma.visit.findMany({
      where: { memberId: member.id },
      orderBy: { enteredAt: "desc" },
      take: 30,
      include: { bay: { select: { number: true } }, location: { select: { name: true } } },
    }),
    prisma.usageTierSnapshot.findFirst({ where: { memberId: member.id }, orderBy: { computedAt: "desc" } }),
    prisma.visit.findMany({
      where: { memberId: member.id, enteredAt: { gte: yearAgo } },
      select: { enteredAt: true },
    }),
  ]);

  const count90d = allYearVisits.filter(
    (v) => v.enteredAt.getTime() >= Date.now() - 90 * 86_400_000,
  ).length;
  const count30d = allYearVisits.filter(
    (v) => v.enteredAt.getTime() >= Date.now() - 30 * 86_400_000,
  ).length;

  // Calculate streak: consecutive days with visits ending today/yesterday
  const visitDates = new Set(allYearVisits.map((v) => v.enteredAt.toISOString().slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  for (let i = 0; i < 365; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    if (visitDates.has(iso)) {
      streak++;
    } else if (i === 0) {
      // Allow not visiting today (yesterday still counts)
    } else {
      break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }

  // Monthly visit count
  const months = lastNMonths(12);
  const monthlyVisits = months.map((m) => ({
    month: m.label,
    visits: allYearVisits.filter((v) => v.enteredAt >= m.start && v.enteredAt < m.end).length,
  }));

  // Day-of-week distribution
  const dowCounts = DAYS_OF_WEEK.map((day) => ({ day, visits: 0 }));
  for (const v of allYearVisits) dowCounts[v.enteredAt.getDay()].visits++;

  // Heatmap cells (per day count for last 12 weeks ≈ 84 days)
  const cellsByDate = new Map<string, number>();
  for (const v of allYearVisits) {
    const k = v.enteredAt.toISOString().slice(0, 10);
    cellsByDate.set(k, (cellsByDate.get(k) ?? 0) + 1);
  }
  const heatmapCells = Array.from(cellsByDate.entries()).map(([date, value]) => ({ date, value }));

  return (
    <div className="space-y-6">
      <h1 className="text-apple-2xl font-semibold tracking-tight">Attendance</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Visits last 30d" value={count30d.toLocaleString()} />
        <KpiCard label="Visits last 90d" value={count90d.toLocaleString()} />
        <KpiCard label="Current streak" value={`${streak} day${streak === 1 ? "" : "s"}`} hint="Consecutive days" />
        <KpiCard
          label="Usage tier"
          value={latestTier?.tier ?? "—"}
          hint={latestTier ? new Date(latestTier.computedAt).toLocaleDateString() : undefined}
        />
      </div>

      <Card>
        <CardHeader title="Activity heatmap" subtitle="Last 12 weeks" />
        <div className="mt-4 overflow-x-auto">
          <Heatmap cells={heatmapCells} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Monthly visits" subtitle="Last 12 months" />
          <div className="mt-4">
            <AreaChart
              data={monthlyVisits}
              xKey="month"
              series={[{ key: "visits", label: "Visits" }]}
              height={200}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="When you visit" subtitle="By day of week" />
          <div className="mt-4">
            <BarChart
              data={dowCounts}
              xKey="day"
              series={[{ key: "visits", label: "Visits" }]}
              height={200}
              colorByCell
            />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent visits" />
        {visits.length === 0 ? (
          <EmptyState icon={<Activity className="h-6 w-6" />} title="No visits yet" />
        ) : (
          <ul className="mt-3 divide-y divide-apple-divider">
            {visits.map((v) => (
              <li key={v.id} className="flex items-center justify-between py-2 text-apple-sm">
                <div>
                  <div className="text-apple-text">{new Date(v.enteredAt).toLocaleString()}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">
                    {v.location.name} {v.bay && `· Bay ${v.bay.number}`}
                  </div>
                </div>
                <StatusBadge status={v.type} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
