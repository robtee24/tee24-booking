import { getPrisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card, CardHeader, PageHeader, StatusBadge } from "@/components/ui";
import { AreaChart, KpiCard } from "@/components/ui/charts";
import { AutomationBuilder, draftFromAutomation } from "@/components/admin/marketing/AutomationBuilder";
import { AutomationEnrollments } from "@/components/admin/marketing/AutomationEnrollments";
import { automationStats } from "@/services/automation.service";
import { loadBuilderOptions } from "../_options";

export const dynamic = "force-dynamic";

export default async function AutomationDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug }, select: { id: true, organizationId: true } });
  if (!location) notFound();
  const automation = await prisma.automation.findUnique({ where: { id }, include: { steps: { orderBy: { order: "asc" } } } });
  if (!automation) notFound();

  const [options, stats, enrollments] = await Promise.all([
    loadBuilderOptions(location),
    automationStats(id),
    prisma.automationEnrollment.findMany({
      where: { automationId: id },
      orderBy: { enrolledAt: "desc" },
      take: 100,
      include: { member: { select: { id: true, firstName: true, lastName: true, email: true, status: true } } },
    }),
  ]);

  const series = stats.series.map((s) => ({ day: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }), enrolled: s.enrolled }));

  return (
    <div className="space-y-6">
      <PageHeader title={automation.name} description={automation.description ?? undefined} meta={<StatusBadge status={automation.active ? "ACTIVE" : "PAUSED"} />} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Enrolled (all time)" value={stats.total.toLocaleString()} />
        <KpiCard label="Active now" value={stats.active.toLocaleString()} />
        <KpiCard label="Completed" value={stats.completed.toLocaleString()} hint={`${stats.exited} exited · ${stats.failed} failed`} />
        <KpiCard label="Enrolled (30d)" value={stats.last30.toLocaleString()} trend={stats.series.map((s) => ({ y: s.enrolled }))} />
      </div>

      {stats.last30 > 0 && (
        <Card>
          <CardHeader title="Enrollments" subtitle="Last 30 days" />
          <div className="mt-4">
            <AreaChart data={series} xKey="day" series={[{ key: "enrolled", label: "Enrolled" }]} height={180} />
          </div>
        </Card>
      )}

      <AutomationBuilder
        initial={draftFromAutomation(automation)}
        options={options}
      />

      <AutomationEnrollments automationId={id} initial={enrollments.map((e) => ({ ...e, nextRunAt: e.nextRunAt?.toISOString() ?? null, enrolledAt: e.enrolledAt.toISOString() }))} />
    </div>
  );
}
