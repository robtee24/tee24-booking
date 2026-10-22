import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader, Button, StatusBadge } from "@/components/ui";
import { BarChart, KpiCard } from "@/components/ui/charts";
import { Plus, Workflow } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { AUTOMATION_PRESETS } from "@/services/automation.service";
import { AutomationGallery } from "@/components/admin/marketing/AutomationGallery";
import { AUTOMATION_TRIGGER_OPTIONS } from "@/components/admin/marketing/constants";

export const dynamic = "force-dynamic";

export default async function AutomationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const [automations, recentEnrollments] = await Promise.all([
    prisma.automation.findMany({
      where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: { _count: { select: { enrollments: true, steps: true } } },
    }),
    prisma.automationEnrollment.groupBy({ by: ["automationId", "status"], _count: { _all: true }, where: { enrolledAt: { gte: since } } }),
  ]);

  const recentBy = new Map<string, { total: number; active: number; completed: number }>();
  for (const r of recentEnrollments) {
    const cur = recentBy.get(r.automationId) ?? { total: 0, active: 0, completed: 0 };
    cur.total += r._count._all;
    if (r.status === "ACTIVE") cur.active += r._count._all;
    if (r.status === "COMPLETED") cur.completed += r._count._all;
    recentBy.set(r.automationId, cur);
  }

  const totalEnrolled = automations.reduce((s, a) => s + a._count.enrollments, 0);
  const activeCount = automations.filter((a) => a.active).length;
  const topByEnrollment = [...automations]
    .filter((a) => a._count.enrollments > 0)
    .sort((a, b) => b._count.enrollments - a._count.enrollments)
    .slice(0, 8)
    .map((a) => ({ name: a.name, enrolled: a._count.enrollments }));
  const triggerLabel = (t: string) => AUTOMATION_TRIGGER_OPTIONS.find((o) => o.value === t)?.label ?? t;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automations"
        description="Triggered flows: welcome series, failed-payment recovery, win-back, birthday wishes, and more."
        actions={
          <Link href={adminRoutes.loc.marketing.automationNew(slug)}>
            <Button iconLeft={<Plus className="h-4 w-4" />}>New automation</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiCard label="Active automations" value={activeCount.toLocaleString()} hint={`of ${automations.length}`} />
        <KpiCard label="Total enrolled" value={totalEnrolled.toLocaleString()} />
        <KpiCard label="Enrolled (30d)" value={recentEnrollments.reduce((s, r) => s + r._count._all, 0).toLocaleString()} />
      </div>

      <AutomationGallery presets={AUTOMATION_PRESETS.map((p) => ({ key: p.key, name: p.name, description: p.description, steps: p.input.steps?.length ?? 0, trigger: p.input.trigger }))} />

      {topByEnrollment.length > 0 && (
        <Card>
          <CardHeader title="Most-used automations" subtitle="By total enrollments" />
          <div className="mt-4">
            <BarChart data={topByEnrollment} xKey="name" series={[{ key: "enrolled", label: "Enrolled" }]} layout="vertical" height={Math.max(220, topByEnrollment.length * 28)} />
          </div>
        </Card>
      )}

      {automations.length === 0 ? (
        <EmptyState
          icon={<Workflow className="h-6 w-6" />}
          title="No automations yet"
          description="Start from a template above or build your own flow."
          action={
            <Link href={adminRoutes.loc.marketing.automationNew(slug)}>
              <Button iconLeft={<Plus className="h-4 w-4" />}>New automation</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {automations.map((a) => {
            const r = recentBy.get(a.id);
            return (
              <Link key={a.id} href={adminRoutes.loc.marketing.automationDetail(slug, a.id)} className="block">
                <Card className="h-full transition-shadow hover:shadow-apple-md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-apple-text">{a.name}</div>
                      {a.description && <div className="mt-0.5 text-apple-xs text-apple-text-tertiary">{a.description}</div>}
                      <div className="mt-2 text-apple-xs text-apple-text-secondary">Trigger: {triggerLabel(a.trigger)}</div>
                      <div className="mt-1 text-apple-xs text-apple-text-tertiary">
                        {a._count.steps} step{a._count.steps === 1 ? "" : "s"} · {a._count.enrollments} enrolled · 30d: {r?.total ?? 0} enrolled / {r?.active ?? 0} active / {r?.completed ?? 0} completed
                      </div>
                    </div>
                    <StatusBadge status={a.active ? "ACTIVE" : "PAUSED"} size="sm" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
