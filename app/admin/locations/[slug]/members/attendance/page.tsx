import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { Activity } from "lucide-react";
import { AttendanceHeatmap, TimeOfDayChart } from "./AttendanceCharts";

export const dynamic = "force-dynamic";

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

  const [todayCount, monthCount, last10, year, ninety, noShowsMtd] = await Promise.all([
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
      select: { enteredAt: true },
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
  ]);

  // Build heatmap (last 365 days) and time-of-day distribution (last 90d)
  const heatmap = bucketByDay(year, yearAgo, now);
  const tod = bucketByHour(ninety);

  return (
    <div className="space-y-6">
      <PageHeader title="Attendance" description="Member visits, demographics, and traffic patterns." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card><div className="text-apple-xs uppercase text-apple-text-tertiary">Today</div><div className="mt-1 text-apple-2xl font-semibold tabular-nums">{todayCount}</div></Card>
        <Card><div className="text-apple-xs uppercase text-apple-text-tertiary">Month-to-date</div><div className="mt-1 text-apple-2xl font-semibold tabular-nums">{monthCount}</div></Card>
        <Card><div className="text-apple-xs uppercase text-apple-text-tertiary">90-day visits</div><div className="mt-1 text-apple-2xl font-semibold tabular-nums">{ninety.length}</div></Card>
        <Card><div className="text-apple-xs uppercase text-apple-text-tertiary">No-shows MTD</div><div className="mt-1 text-apple-2xl font-semibold tabular-nums">{noShowsMtd}</div></Card>
      </div>

      <Card>
        <CardHeader title="Visit heatmap" subtitle="Last 365 days · darker = more visits" />
        <div className="mt-4 overflow-x-auto">
          <AttendanceHeatmap data={heatmap} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Time of day" subtitle="Last 90 days · visits per hour" />
        <div className="mt-4">
          <TimeOfDayChart data={tod} />
        </div>
      </Card>

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
