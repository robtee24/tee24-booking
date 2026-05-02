import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { BarChart, KpiCard } from "@/components/ui/charts";
import { Activity } from "lucide-react";
import { AttendanceHeatmap, TimeOfDayChart } from "./AttendanceCharts";
import {
  visitFrequencyDistribution,
  topMembersByVisits,
  visitsByDay,
} from "@/lib/chart-data";

export const dynamic = "force-dynamic";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function AttendancePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000);
  const ninetyAgo = new Date(now.getTime() - 90 * 86_400_000);

  const [todayCount, monthCount, last10, year, ninety, noShowsMtd, freqDist, topMembers, last7d] = await Promise.all([
    prisma.visit.count({ where: { locationId: location.id, enteredAt: { gte: todayStart } } }),
    prisma.visit.count({ where: { locationId: location.id, enteredAt: { gte: monthStart } } }),
    prisma.visit.findMany({
      where: { locationId: location.id },
      orderBy: { enteredAt: "desc" },
      take: 10,
      include: {
        member: { select: { id: true, firstName: true, lastName: true } },
        bay: { select: { number: true } },
      },
    }),
    prisma.visit.findMany({
      where: { locationId: location.id, enteredAt: { gte: yearAgo } },
      select: { enteredAt: true, type: true },
    }),
    prisma.visit.findMany({
      where: { locationId: location.id, enteredAt: { gte: ninetyAgo } },
      select: { enteredAt: true },
    }),
    prisma.booking.count({
      where: {
        locationId: location.id,
        canceledAt: null,
        checkedInAt: null,
        end: { lt: now, gte: monthStart },
      },
    }),
    visitFrequencyDistribution({ locationId: location.id }),
    topMembersByVisits({ locationId: location.id, limit: 10 }),
    visitsByDay({ locationId: location.id, days: 7 }),
  ]);

  const heatmap = bucketByDay(year, yearAgo, now);
  const tod = bucketByHour(ninety);
  const dayOfWeek = bucketByDayOfWeek(year);

  const visitsTrend = last7d.map((v) => ({ y: v.visits }));

  return (
    <div className="space-y-6">
      <PageHeader title="Attendance" description="Member visits, demographics, and traffic patterns." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Today" value={todayCount.toLocaleString()} trend={visitsTrend} />
        <KpiCard label="Month-to-date" value={monthCount.toLocaleString()} />
        <KpiCard label="90-day visits" value={ninety.length.toLocaleString()} />
        <KpiCard label="No-shows MTD" value={noShowsMtd.toLocaleString()} hint="Bookings without check-in" />
      </div>

      <Card>
        <CardHeader title="Visit heatmap" subtitle="Last 365 days · darker = more visits" />
        <div className="mt-4 overflow-x-auto">
          <AttendanceHeatmap data={heatmap} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Day of week" subtitle="Last 365 days · visit type breakdown" />
          <div className="mt-4">
            <BarChart
              data={dayOfWeek}
              xKey="day"
              series={[
                { key: "checkIn", label: "Check-ins" },
                { key: "booking", label: "Bookings" },
              ]}
              stacked
              showLegend
              height={220}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Time of day" subtitle="Last 90 days · visits per hour" />
          <div className="mt-4">
            <TimeOfDayChart data={tod} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Visit frequency" subtitle="Members by visits this month" />
          <div className="mt-4">
            <BarChart
              data={freqDist}
              xKey="range"
              series={[{ key: "members", label: "Members" }]}
              height={220}
              colorByCell
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Most active members" subtitle="Top 10 this month" />
          <div className="mt-4">
            {topMembers.length === 0 ? (
              <p className="text-apple-sm text-apple-text-tertiary">No member visits yet this month.</p>
            ) : (
              <BarChart
                data={topMembers}
                xKey="name"
                series={[{ key: "visits", label: "Visits" }]}
                layout="vertical"
                height={Math.max(220, topMembers.length * 28)}
              />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent visits" subtitle="From Kisi door unlocks and Bay App check-ins (deduped per location window)" />
        {last10.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-6 w-6" />}
            title="No visits yet"
            description="Visits are recorded automatically when members unlock the door via Kisi."
          />
        ) : (
          <ul className="mt-4 divide-y divide-apple-divider">
            {last10.map((v) => (
              <li key={v.id} className="flex items-center justify-between py-3 text-apple-sm">
                <div>
                  <div className="font-medium text-apple-text">
                    {v.member ? `${v.member.firstName} ${v.member.lastName}` : "Visitor"}
                  </div>
                  <div className="text-apple-xs text-apple-text-tertiary">
                    {new Date(v.enteredAt).toLocaleString()} {v.bay && `· Bay ${v.bay.number}`}
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

function bucketByDay(visits: Array<{ enteredAt: Date }>, start: Date, end: Date) {
  const map = new Map<string, number>();
  for (const v of visits) {
    const k = v.enteredAt.toISOString().slice(0, 10);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  const days: { date: string; count: number }[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    days.push({ date: k, count: map.get(k) ?? 0 });
  }
  return days;
}

function bucketByHour(visits: Array<{ enteredAt: Date }>) {
  const buckets = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
  for (const v of visits) {
    const h = v.enteredAt.getHours();
    buckets[h].count++;
  }
  return buckets;
}

function bucketByDayOfWeek(visits: Array<{ enteredAt: Date; type: string }>) {
  const buckets = DAYS_OF_WEEK.map((day) => ({ day, checkIn: 0, booking: 0 }));
  for (const v of visits) {
    const dow = v.enteredAt.getDay();
    if (v.type === "BOOKING") buckets[dow].booking++;
    else buckets[dow].checkIn++;
  }
  return buckets;
}
