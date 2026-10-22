import { getPrisma } from "@/lib/db";
import { getCurrentAdmin } from "@/lib/access";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { BarChart, DonutChart, KpiCard } from "@/components/ui/charts";
import { lastNDays } from "@/lib/chart-data";
import { inboxWhere, unreadWhere } from "@/services/staff.service";
import { InboxClient } from "./InboxClient";

export const dynamic = "force-dynamic";

export default async function NotificationsInbox() {
  const admin = await getCurrentAdmin();
  if (!admin) return null;
  const prisma = getPrisma();

  const scope = { role: admin.role, locationIds: admin.locations.map((l) => l.locationId) };
  const where = inboxWhere(scope);

  const sevenAgo = new Date();
  sevenAgo.setDate(sevenAgo.getDate() - 7);

  const [unread, recentForChart] = await Promise.all([
    prisma.adminNotification.count({ where: unreadWhere(scope) }),
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
      <PageHeader title="Notifications" description="Operational alerts across your locations. Click to open and mark read, or snooze for a day." />

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

      <InboxClient initialUnread={unread} />
    </div>
  );
}
