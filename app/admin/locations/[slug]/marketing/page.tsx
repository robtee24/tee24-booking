import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { Badge, Button, Card, CardHeader, EmptyState, Money, PageHeader } from "@/components/ui";
import { AreaChart, BarChart, DonutChart, Funnel, KpiCard } from "@/components/ui/charts";
import { CalendarClock, Gift, Megaphone, Send, UserPlus } from "lucide-react";
import { acquisitionFunnelBySource, followUpsDue, lastNMonths, visitorFunnel } from "@/lib/chart-data";
import { adminRoutes } from "@/lib/admin/routes";
import { LEAD_STAGE_TONES, normalizeLeadStage } from "@/components/admin/marketing/constants";
import { getMarketingSettings } from "@/services/marketing.service";

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
    bySource,
    followUps,
    latestReferrals,
    settings,
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
    acquisitionFunnelBySource({ locationId: location.id, days: 90 }),
    followUpsDue({ locationId: location.id, limit: 8 }),
    prisma.referral.findMany({ orderBy: { createdAt: "desc" }, take: 6 }),
    getMarketingSettings(location.organizationId),
  ]);
  const referralMemberIds = Array.from(new Set(latestReferrals.flatMap((r) => [r.referrerId, r.referredMemberId])));
  const referralMembers = referralMemberIds.length
    ? await prisma.member.findMany({ where: { id: { in: referralMemberIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const rm = new Map(referralMembers.map((m) => [m.id, `${m.firstName} ${m.lastName}`]));
  const sourceFunnelData = bySource.map((r) => ({ name: r.source, leads: r.leads, contacted: r.contacted, booked: r.booked, converted: r.converted }));

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
    .map((s) => ({ name: s.source ?? "Unknown", value: s._count._all ?? 0 }))
    .filter((s) => s.value > 0);

  const stageCounts = new Map<string, number>();
  for (const s of visitorsByStage) {
    const k = normalizeLeadStage(s.stage);
    stageCounts.set(k, (stageCounts.get(k) ?? 0) + (s._count._all ?? 0));
  }
  const visitorStageData = Array.from(stageCounts.entries())
    .map(([name, value]) => ({ name: settings.leadStageLabels[name as keyof typeof settings.leadStageLabels] ?? name, value }))
    .filter((s) => s.value > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketing"
        description="Acquisition, attribution, and engagement."
        actions={
          <div className="flex gap-2">
            <Link href={adminRoutes.loc.marketing.visitors(slug)}>
              <Button variant="secondary" iconLeft={<UserPlus className="h-4 w-4" />}>Leads</Button>
            </Link>
            <Link href={adminRoutes.loc.marketing.compose(slug)}>
              <Button iconLeft={<Send className="h-4 w-4" />}>New broadcast</Button>
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="New members MTD" value={signupsMtd.toLocaleString()} trend={trendSpark} />
        <KpiCard label="Open leads" value={visitorsCount.toLocaleString()} hint={`${followUps.length} follow-up${followUps.length === 1 ? "" : "s"} due`} />
        <KpiCard label="Email open rate" value={`${openPct}%`} hint={`${opens} / ${sent} sent`} />
        <KpiCard label="Email click rate" value={`${clickPct}%`} hint={`${clicks} clicks`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Lead → member funnel" subtitle="Last 30 days" />
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
          <CardHeader title="Leads by stage" subtitle="Pipeline overview" />
          <div className="mt-2">
            {visitorStageData.length === 0 ? (
              <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">No leads in pipeline yet.</p>
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

      <Card>
        <CardHeader title="Acquisition funnel by source" subtitle="Leads created in the last 90 days, by where they came from" />
        <div className="mt-4">
          {sourceFunnelData.length === 0 ? (
            <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">No leads with a source yet. Sources are set on leads, signup forms and inbound texts.</p>
          ) : (
            <BarChart
              data={sourceFunnelData}
              xKey="name"
              series={[
                { key: "leads", label: "Leads" },
                { key: "contacted", label: "Contacted" },
                { key: "booked", label: "Booked / trial" },
                { key: "converted", label: "Converted" },
              ]}
              showLegend
              height={Math.max(220, sourceFunnelData.length * 36)}
              layout="vertical"
            />
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padded={false}>
          <div className="flex items-center justify-between border-b border-apple-divider px-4 py-3">
            <CardHeader title="Follow-ups due" subtitle="Today and overdue" className="!mb-0" />
            <Link href={`${adminRoutes.loc.marketing.visitors(slug)}?followUp=due`} className="text-apple-xs font-medium text-apple-blue hover:underline">All leads →</Link>
          </div>
          {followUps.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-apple-text-tertiary">
              <CalendarClock className="h-6 w-6" />
              <p className="text-apple-sm">You&apos;re caught up.</p>
            </div>
          ) : (
            <ul className="divide-y divide-apple-divider">
              {followUps.map((l) => {
                const stage = normalizeLeadStage(l.stage);
                const overdue = l.nextFollowUpAt && l.nextFollowUpAt < new Date(new Date().setHours(0, 0, 0, 0));
                return (
                  <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-apple-sm">
                    <div className="min-w-0">
                      <Link href={`${adminRoutes.loc.marketing.visitors(slug)}?lead=${l.id}`} className="truncate font-medium text-apple-text hover:text-apple-blue">
                        {`${l.firstName ?? ""} ${l.lastName ?? ""}`.trim() || l.email || l.phone || "Lead"}
                      </Link>
                      <div className="truncate text-apple-xs text-apple-text-tertiary">{[l.source, l.assignedToId ? "assigned" : null].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={overdue ? "danger" : "warn"} size="sm">{overdue ? "Overdue" : "Today"}</Badge>
                      <Badge tone={LEAD_STAGE_TONES[stage]} size="sm">{settings.leadStageLabels[stage]}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card padded={false}>
          <div className="flex items-center justify-between border-b border-apple-divider px-4 py-3">
            <CardHeader title="Latest referrals" className="!mb-0" />
            <Link href={adminRoutes.loc.marketing.referrals(slug)} className="text-apple-xs font-medium text-apple-blue hover:underline">Referrals →</Link>
          </div>
          {latestReferrals.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-apple-text-tertiary">
              <Gift className="h-6 w-6" />
              <p className="text-apple-sm">No referrals recorded yet.</p>
            </div>
          ) : (
            <ul className="divide-y divide-apple-divider">
              {latestReferrals.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-apple-sm">
                  <div className="min-w-0 truncate">
                    <span className="font-medium text-apple-text">{rm.get(r.referrerId) ?? "Member"}</span>
                    <span className="text-apple-text-tertiary"> referred </span>
                    <span className="font-medium text-apple-text">{rm.get(r.referredMemberId) ?? "member"}</span>
                    <div className="text-apple-xs text-apple-text-tertiary">{r.createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {r.earnedKind === "CREDIT" ? "credit" : "payment"}</div>
                  </div>
                  <Money cents={r.earnedCents} className="shrink-0 font-medium" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
