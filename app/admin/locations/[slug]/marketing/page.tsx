import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { AreaChart, BarChart, DonutChart, Funnel, KpiCard } from "@/components/ui/charts";
import { Megaphone } from "lucide-react";
import { lastNMonths, visitorFunnel } from "@/lib/chart-data";

export const dynamic = "force-dynamic";

export default async function MarketingDashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

  const [
    signupsMtd,
    visitorsCount,
    emailMessages,
    sourceBreakdown,
    funnel,
    signupsByMonth,
    visitorsByStage,
  ] = await Promise.all([
    prisma.member.count({ where: { locationId: location.id, joinDate: { gte: monthStart } } }),
    prisma.visitor.count({ where: { locationId: location.id, stage: { in: ["NEW", "ENGAGED"] } } }),
    prisma.message.findMany({
      where: { member: { locationId: location.id }, channel: "EMAIL", category: "MARKETING", createdAt: { gte: monthStart } },
      select: { status: true, openedAt: true, clickedAt: true },
    }),
    prisma.member.groupBy({
      by: ["source"],
      _count: { _all: true },
      where: { locationId: location.id, joinDate: { gte: monthStart } },
    }),
    visitorFunnel({ locationId: location.id, days: 30 }),
    prisma.member.findMany({
      where: { locationId: location.id, joinDate: { gte: sixMonthsAgo } },
      select: { joinDate: true },
    }),
    prisma.visitor.groupBy({
      by: ["stage"],
      _count: { _all: true },
      where: { locationId: location.id },
    }),
  ]);

  const opens = emailMessages.filter((m) => m.openedAt).length;
  const clicks = emailMessages.filter((m) => m.clickedAt).length;
  const sent = emailMessages.length;
  const openPct = sent > 0 ? Math.round((opens / sent) * 100) : 0;
  const clickPct = sent > 0 ? Math.round((clicks / sent) * 100) : 0;

  const months = lastNMonths(6);
  const signupTrend = months.map((m) => {
    const count = signupsByMonth.filter((s) => s.joinDate && s.joinDate >= m.start && s.joinDate < m.end).length;
    return { month: m.label, signups: count };
  });
  const trendSpark = signupTrend.map((s) => ({ y: s.signups }));

  const sourcesData = sourceBreakdown
    .map((s: any) => ({ name: s.source ?? "Unknown", value: s._count?._all ?? 0 }))
    .filter((s) => s.value > 0);

  const visitorStageData = visitorsByStage
    .map((s: any) => ({ name: s.stage ?? "Unknown", value: s._count?._all ?? 0 }))
    .filter((s) => s.value > 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Marketing" description="Acquisition, attribution, and engagement." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="New members MTD" value={signupsMtd.toLocaleString()} trend={trendSpark} />
        <KpiCard label="Active visitors" value={visitorsCount.toLocaleString()} hint="In NEW / ENGAGED" />
        <KpiCard label="Email open rate" value={`${openPct}%`} hint={`${opens} / ${sent} sent`} />
        <KpiCard label="Email click rate" value={`${clickPct}%`} hint={`${clicks} clicks`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Visitor → member funnel" subtitle="Last 30 days" />
          <div className="mt-4">
            <Funnel stages={funnel} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Signups over time" subtitle="Last 6 months" />
          <div className="mt-4">
            <AreaChart
              data={signupTrend}
              xKey="month"
              series={[{ key: "signups", label: "New members" }]}
              height={220}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Member sources (MTD)" />
          <div className="mt-2">
            {sourcesData.length === 0 ? (
              <EmptyState icon={<Megaphone className="h-6 w-6" />} title="No new members yet this month" />
            ) : (
              <DonutChart data={sourcesData} height={220} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Visitors by stage" subtitle="Pipeline overview" />
          <div className="mt-2">
            {visitorStageData.length === 0 ? (
              <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">No visitors in pipeline yet.</p>
            ) : (
              <BarChart
                data={visitorStageData}
                xKey="name"
                series={[{ key: "value", label: "Visitors" }]}
                height={220}
                colorByCell
              />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
