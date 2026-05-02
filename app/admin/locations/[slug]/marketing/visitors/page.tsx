import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { AreaChart, BarChart, DonutChart, Funnel, KpiCard } from "@/components/ui/charts";
import { UserPlus } from "lucide-react";
import { lastNMonths, visitorFunnel } from "@/lib/chart-data";

export const dynamic = "force-dynamic";

const STAGE_ORDER = ["NEW", "ENGAGED", "CONVERTED", "LOST"];

export default async function VisitorsFunnelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const [stages, recent, funnel, last6mo, sourceRows] = await Promise.all([
    prisma.visitor.groupBy({
      by: ["stage"],
      _count: { _all: true },
      where: { locationId: location.id },
    }),
    prisma.visitor.findMany({
      where: { locationId: location.id },
      orderBy: { updatedAt: "desc" },
      take: 25,
    }),
    visitorFunnel({ locationId: location.id, days: 30 }),
    prisma.visitor.findMany({
      where: { locationId: location.id, createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true, stage: true },
    }),
    prisma.visitor.groupBy({
      by: ["source"],
      _count: { _all: true },
      where: { locationId: location.id, createdAt: { gte: sixMonthsAgo } },
    }),
  ]);

  const counts: Record<string, number> = Object.fromEntries(
    stages.map((s: any) => [s.stage, s._count?._all ?? 0]),
  );
  const totalVisitors = Object.values(counts).reduce((a: number, b: any) => a + (b as number), 0);
  const conversionRate =
    totalVisitors > 0 ? Number((((counts.CONVERTED ?? 0) / totalVisitors) * 100).toFixed(1)) : 0;

  const months = lastNMonths(6);
  const conversionTrend = months.map((m) => {
    const inMonth = last6mo.filter((v) => v.createdAt >= m.start && v.createdAt < m.end);
    const conv = inMonth.filter((v) => v.stage === "CONVERTED").length;
    return {
      month: m.label,
      conversion: inMonth.length > 0 ? Number(((conv / inMonth.length) * 100).toFixed(1)) : 0,
      leads: inMonth.length,
    };
  });

  const sourceData = sourceRows
    .map((s: any) => ({ name: s.source ?? "(direct)", value: s._count?._all ?? 0 }))
    .filter((s) => s.value > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visitors funnel"
        description="Day-pass buyers, free-pass guests, and inquiries on their way to membership."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {STAGE_ORDER.map((stage) => (
          <KpiCard
            key={stage}
            label={stage}
            value={(counts[stage] ?? 0).toLocaleString()}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Conversion funnel" subtitle="Last 30 days" />
          <div className="mt-4">
            <Funnel stages={funnel} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Conversion rate over time"
            subtitle={`${conversionRate}% all-time conversion`}
          />
          <div className="mt-4">
            <AreaChart
              data={conversionTrend}
              xKey="month"
              series={[{ key: "conversion", label: "Conversion %" }]}
              yFormatter={(v) => `${v}%`}
              height={200}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Lead sources" subtitle="Last 6 months" />
          <div className="mt-2">
            {sourceData.length === 0 ? (
              <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">
                No tracked sources yet.
              </p>
            ) : (
              <DonutChart data={sourceData} height={220} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Leads per month" />
          <div className="mt-4">
            <BarChart
              data={conversionTrend}
              xKey="month"
              series={[{ key: "leads", label: "Leads" }]}
              height={200}
              colorByCell
            />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent visitors" />
        {recent.length === 0 ? (
          <EmptyState
            icon={<UserPlus className="h-6 w-6" />}
            title="No visitors yet"
            description="Visitors are auto-created from day-pass purchases and signup-form starts."
          />
        ) : (
          <ul className="mt-4 divide-y divide-apple-divider">
            {recent.map((v) => (
              <li key={v.id} className="flex items-center justify-between py-2 text-apple-sm">
                <div>
                  <div className="font-medium text-apple-text">
                    {v.firstName ?? "(no name)"} {v.lastName ?? ""}
                  </div>
                  <div className="text-apple-xs text-apple-text-tertiary">
                    {v.email ?? v.phone ?? "—"} · {v.source ?? "direct"}
                  </div>
                </div>
                <StatusBadge status={v.stage} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
