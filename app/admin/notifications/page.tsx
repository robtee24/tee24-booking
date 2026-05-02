import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { BarChart, DonutChart, KpiCard } from "@/components/ui/charts";
import { Bell } from "lucide-react";
import { lastNDays } from "@/lib/chart-data";

export const dynamic = "force-dynamic";

export default async function NotificationsInbox() {
  const admin = await getCurrentAdmin();
  if (!admin) return null;
  const prisma = getPrisma();

  const where: any = {};
  if (!isFullAccess(admin.role)) {
    where.locationId = { in: admin.locations.map((l) => l.locationId) };
  }

  const sevenAgo = new Date();
  sevenAgo.setDate(sevenAgo.getDate() - 7);

  const [notes, unread, recentForChart] = await Promise.all([
    prisma.adminNotification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.adminNotification.count({ where: { ...where, readAt: null } }),
    prisma.adminNotification.findMany({
      where: { ...where, createdAt: { gte: sevenAgo } },
      select: { createdAt: true, severity: true },
    }),
  ]);

  const days = lastNDays(7);
  const dailyVolume = days.map((iso) => ({
    label: new Date(iso).toLocaleDateString(undefined, { weekday: "short" }),
    notifications: recentForChart.filter((n) => n.createdAt.toISOString().slice(0, 10) === iso).length,
  }));

  const severityCounts: Record<string, number> = {};
  for (const n of recentForChart) {
    severityCounts[n.severity] = (severityCounts[n.severity] ?? 0) + 1;
  }
  const severitySlices = Object.entries(severityCounts)
    .map(([name, value]) => ({ name, value }))
    .filter((s) => s.value > 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" description="Operational alerts across your locations." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiCard label="Unread" value={unread.toLocaleString()} hint="Tap a notification to mark read" />
        <KpiCard label="Last 7 days" value={recentForChart.length.toLocaleString()} />
        <KpiCard
          label="Errors (7d)"
          value={(severityCounts.ERROR ?? 0).toLocaleString()}
          hint={(severityCounts.ERROR ?? 0) > 0 ? "Investigate ASAP" : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Volume — last 7 days" />
          <div className="mt-4">
            <BarChart
              data={dailyVolume}
              xKey="label"
              series={[{ key: "notifications", label: "Notifications" }]}
              height={200}
              colorByCell
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="By severity" subtitle="Last 7 days" />
          <div className="mt-2">
            {severitySlices.length === 0 ? (
              <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">No notifications.</p>
            ) : (
              <DonutChart data={severitySlices} useStatusColors height={200} />
            )}
          </div>
        </Card>
      </div>

      <Card padded={false}>
        <CardHeader title="Inbox" className="p-5" />
        {notes.length === 0 ? (
          <EmptyState icon={<Bell className="h-6 w-6" />} title="Inbox zero" description="No notifications yet." />
        ) : (
          <ul className="divide-y divide-apple-divider">
            {notes.map((n) => (
              <li key={n.id} className={`p-4 ${!n.readAt ? "bg-apple-blue/5" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-apple-text">{n.title}</span>
                      <StatusBadge status={n.severity} size="sm" />
                    </div>
                    {n.body && <p className="mt-1 text-apple-sm text-apple-text-secondary">{n.body}</p>}
                    <div className="mt-1 text-apple-xs text-apple-text-tertiary">
                      {n.kind} · {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {n.link && (
                    <Link href={n.link} className="text-apple-sm text-apple-blue hover:underline">
                      Open
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
