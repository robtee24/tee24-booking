import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader, Button, StatusBadge } from "@/components/ui";
import { BarChart, KpiCard } from "@/components/ui/charts";
import { Plus, Workflow } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AutomationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const automations = await prisma.automation.findMany({
    where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { enrollments: true, steps: true } } },
  });

  const totalEnrolled = automations.reduce((s, a) => s + a._count.enrollments, 0);
  const activeCount = automations.filter((a) => a.active).length;
  const topByEnrollment = [...automations]
    .sort((a, b) => b._count.enrollments - a._count.enrollments)
    .slice(0, 8)
    .map((a) => ({ name: a.name, enrolled: a._count.enrollments }));

  return (
    <div className="space-y-6">
      <PageHeader title="Automations" description="Triggered flows: signup welcome, failed-payment recovery, win-back, birthday wishes, and more." actions={<Button iconLeft={<Plus className="h-4 w-4" />}>New automation</Button>} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiCard label="Active automations" value={activeCount.toLocaleString()} hint={`of ${automations.length}`} />
        <KpiCard label="Total enrolled" value={totalEnrolled.toLocaleString()} />
        <KpiCard label="Avg per flow" value={automations.length > 0 ? Math.round(totalEnrolled / automations.length).toLocaleString() : "0"} />
      </div>

      {topByEnrollment.length > 0 && (
        <Card>
          <CardHeader title="Most-used automations" subtitle="By active enrollments" />
          <div className="mt-4">
            <BarChart
              data={topByEnrollment}
              xKey="name"
              series={[{ key: "enrolled", label: "Enrolled" }]}
              layout="vertical"
              height={Math.max(220, topByEnrollment.length * 28)}
            />
          </div>
        </Card>
      )}

      {automations.length === 0 ? (
        <EmptyState
          icon={<Workflow className="h-6 w-6" />}
          title="No automations yet"
          description="Build a flow that triggers on signup, payment failure, plan change, attendance milestones, churn risk, birthdays, and more."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {automations.map((a) => (
            <Card key={a.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-apple-text">{a.name}</div>
                  {a.description && <div className="mt-0.5 text-apple-xs text-apple-text-tertiary">{a.description}</div>}
                  <div className="mt-2 text-apple-xs text-apple-text-secondary">
                    Trigger: <span className="font-mono">{a.trigger}</span>
                  </div>
                  <div className="mt-1 text-apple-xs text-apple-text-tertiary">
                    {a._count.steps} step{a._count.steps === 1 ? "" : "s"} · {a._count.enrollments} enrolled
                  </div>
                </div>
                <StatusBadge status={a.active ? "ACTIVE" : "CANCELLED"} size="sm" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
