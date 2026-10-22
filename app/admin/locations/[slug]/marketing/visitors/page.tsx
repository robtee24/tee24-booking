import { Suspense } from "react";
import { getPrisma } from "@/lib/db";
import { getCurrentAdmin } from "@/lib/access";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { AreaChart, DonutChart, Funnel, KpiCard } from "@/components/ui/charts";
import { lastNMonths, visitorFunnel } from "@/lib/chart-data";
import { LEAD_STAGES, normalizeLeadStage } from "@/components/admin/marketing/constants";
import { LeadsClient } from "@/components/admin/marketing/LeadsClient";
import { listLeads } from "@/services/lead.service";
import { getMarketingSettings } from "@/services/marketing.service";

export const dynamic = "force-dynamic";

export default async function LeadsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const [leads, funnel, last6mo, sourceRows, settings, admins, admin] = await Promise.all([
    listLeads({ locationId: location.id }),
    visitorFunnel({ locationId: location.id, days: 30 }),
    prisma.visitor.findMany({ where: { locationId: location.id, createdAt: { gte: sixMonthsAgo } }, select: { createdAt: true, stage: true } }),
    prisma.visitor.groupBy({ by: ["source"], _count: { _all: true }, where: { locationId: location.id, createdAt: { gte: sixMonthsAgo } } }),
    getMarketingSettings(location.organizationId),
    prisma.admin.findMany({
      where: { OR: [{ role: { in: ["ROOT", "FULL"] } }, { locations: { some: { locationId: location.id } } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
    getCurrentAdmin(),
  ]);

  const counts: Record<string, number> = {};
  for (const l of leads) counts[l.stage] = (counts[l.stage] ?? 0) + 1;
  const total = leads.length;
  const conversionRate = total > 0 ? Number((((counts.CONVERTED ?? 0) / total) * 100).toFixed(1)) : 0;
  const dueToday = leads.filter((l) => l.nextFollowUpAt && l.nextFollowUpAt <= endOfToday() && l.stage !== "CONVERTED" && l.stage !== "LOST").length;

  const months = lastNMonths(6);
  const trend = months.map((m) => {
    const inMonth = last6mo.filter((v) => v.createdAt >= m.start && v.createdAt < m.end);
    const conv = inMonth.filter((v) => normalizeLeadStage(v.stage) === "CONVERTED").length;
    return { month: m.label, leads: inMonth.length, conversion: inMonth.length > 0 ? Number(((conv / inMonth.length) * 100).toFixed(1)) : 0 };
  });
  const sourceData = sourceRows.map((s) => ({ name: s.source ?? "(direct)", value: s._count._all })).filter((s) => s.value > 0);

  const initial = leads.map((l) => ({
    id: l.id,
    stage: l.stage,
    source: l.source,
    firstName: l.firstName,
    lastName: l.lastName,
    email: l.email,
    phone: l.phone,
    notes: l.notes,
    tags: l.tags,
    assignedToId: l.assignedToId,
    nextFollowUpAt: l.nextFollowUpAt?.toISOString() ?? null,
    lastContactedAt: l.lastContactedAt?.toISOString() ?? null,
    convertedToMemberId: l.convertedToMemberId,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Leads" description="Everyone on their way to membership: inquiries, inbound texts, day-pass guests and trials." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <KpiCard label="Follow-ups due" value={dueToday.toLocaleString()} hint="Today or overdue" />
        {LEAD_STAGES.map((stage) => (
          <KpiCard key={stage} label={settings.leadStageLabels[stage]} value={(counts[stage] ?? 0).toLocaleString()} />
        ))}
      </div>

      <Suspense>
        <LeadsClient initial={initial} sources={settings.sources} admins={admins} stageLabels={settings.leadStageLabels} currentAdminId={admin?.id ?? null} />
      </Suspense>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Pipeline funnel" subtitle="Leads created in the last 30 days" />
          <div className="mt-4"><Funnel stages={funnel} height={200} /></div>
        </Card>
        <Card>
          <CardHeader title="Leads & conversion" subtitle={`${conversionRate}% all-time conversion`} />
          <div className="mt-4"><AreaChart data={trend} xKey="month" series={[{ key: "leads", label: "Leads" }]} height={200} /></div>
        </Card>
        <Card>
          <CardHeader title="Lead sources" subtitle="Last 6 months" />
          <div className="mt-2">{sourceData.length === 0 ? <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">No tracked sources yet.</p> : <DonutChart data={sourceData} height={200} />}</div>
        </Card>
      </div>
    </div>
  );
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
