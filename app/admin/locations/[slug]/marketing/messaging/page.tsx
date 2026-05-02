import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader, Button, StatusBadge } from "@/components/ui";
import { AreaChart, BarChart, DonutChart, KpiCard, LineChart } from "@/components/ui/charts";
import { MessageSquare, Send } from "lucide-react";
import { lastNDays } from "@/lib/chart-data";

export const dynamic = "force-dynamic";

export default async function MessagingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const ninetyAgo = new Date();
  ninetyAgo.setDate(ninetyAgo.getDate() - 30);

  const [messages, last30Stats, channelMix] = await Promise.all([
    prisma.message.findMany({
      where: { member: { locationId: location.id }, category: "MARKETING" },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { member: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.message.findMany({
      where: { member: { locationId: location.id }, createdAt: { gte: ninetyAgo } },
      select: {
        createdAt: true,
        status: true,
        openedAt: true,
        clickedAt: true,
        channel: true,
      },
    }),
    prisma.message.groupBy({
      by: ["channel"],
      _count: { _all: true },
      where: { member: { locationId: location.id }, createdAt: { gte: ninetyAgo } },
    }),
  ]);

  const totalSent = last30Stats.length;
  const opens = last30Stats.filter((m) => m.openedAt).length;
  const clicks = last30Stats.filter((m) => m.clickedAt).length;
  const failed = last30Stats.filter((m) => m.status === "FAILED" || m.status === "BOUNCED").length;
  const openRate = totalSent > 0 ? Math.round((opens / totalSent) * 100) : 0;
  const clickRate = totalSent > 0 ? Math.round((clicks / totalSent) * 100) : 0;
  const bounceRate = totalSent > 0 ? Math.round((failed / totalSent) * 100) : 0;

  const days = lastNDays(30);
  const dailyStats = days.map((iso) => {
    const day = new Date(iso);
    const dayStats = last30Stats.filter(
      (m) =>
        m.createdAt.getFullYear() === day.getFullYear() &&
        m.createdAt.getMonth() === day.getMonth() &&
        m.createdAt.getDate() === day.getDate(),
    );
    const sent = dayStats.length;
    const opens = dayStats.filter((m) => m.openedAt).length;
    const clicks = dayStats.filter((m) => m.clickedAt).length;
    return {
      label: new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      sent,
      openRate: sent > 0 ? Number(((opens / sent) * 100).toFixed(1)) : 0,
      clickRate: sent > 0 ? Number(((clicks / sent) * 100).toFixed(1)) : 0,
    };
  });

  const channelData = channelMix
    .map((c: any) => ({ name: c.channel ?? "Unknown", value: c._count?._all ?? 0 }))
    .filter((c) => c.value > 0);

  const sendVolumeTrend = dailyStats.slice(-7).map((d) => ({ y: d.sent }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messaging"
        description="Bulk emails (Resend) and SMS (Quo). All sends honor opt-out preferences."
        actions={
          <Link href={`/admin/locations/${slug}/marketing/messaging/compose`}>
            <Button iconLeft={<Send className="h-4 w-4" />}>New broadcast</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Sent (30d)" value={totalSent.toLocaleString()} trend={sendVolumeTrend} />
        <KpiCard label="Open rate" value={`${openRate}%`} hint={`${opens} opens`} />
        <KpiCard label="Click rate" value={`${clickRate}%`} hint={`${clicks} clicks`} />
        <KpiCard label="Bounce rate" value={`${bounceRate}%`} hint={`${failed} failed/bounced`} />
      </div>

      <Card>
        <CardHeader title="Send volume" subtitle="Last 30 days" />
        <div className="mt-4">
          <AreaChart
            data={dailyStats}
            xKey="label"
            series={[{ key: "sent", label: "Messages sent" }]}
            height={200}
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Engagement rates" subtitle="Daily open & click %" />
          <div className="mt-4">
            <LineChart
              data={dailyStats}
              xKey="label"
              series={[
                { key: "openRate", label: "Open %" },
                { key: "clickRate", label: "Click %" },
              ]}
              yFormatter={(v) => `${v}%`}
              showLegend
              height={220}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Channel mix" subtitle="Last 30 days" />
          <div className="mt-2">
            {channelData.length === 0 ? (
              <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">No messages sent yet.</p>
            ) : (
              <DonutChart data={channelData} height={220} />
            )}
          </div>
        </Card>
      </div>

      <Card padded={false}>
        <div className="border-b border-apple-divider px-4 py-3">
          <div className="text-apple-sm font-semibold text-apple-text">Recent messages</div>
        </div>
        {messages.length === 0 ? (
          <EmptyState icon={<MessageSquare className="h-6 w-6" />} title="No marketing messages yet" />
        ) : (
          <ul className="divide-y divide-apple-divider">
            {messages.map((m) => (
              <li key={m.id} className="flex items-center justify-between p-4 text-apple-sm">
                <div>
                  <div className="font-medium text-apple-text">{m.subject ?? m.body.slice(0, 80)}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">
                    {m.channel} · to {m.member?.firstName} {m.member?.lastName} · {new Date(m.createdAt).toLocaleString()}
                  </div>
                </div>
                <StatusBadge status={m.status} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
