import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { Megaphone } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MarketingDashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [signupsMtd, visitorsCount, openRate, sourceBreakdown] = await Promise.all([
    prisma.member.count({ where: { locationId: location.id, joinDate: { gte: monthStart } } }),
    prisma.visitor.count({ where: { locationId: location.id, stage: { in: ["NEW", "ENGAGED"] } } }),
    prisma.message.findMany({
      where: { member: { locationId: location.id }, channel: "EMAIL", category: "MARKETING", createdAt: { gte: monthStart } },
      select: { status: true, openedAt: true },
    }),
    prisma.member.groupBy({
      by: ["source"],
      _count: true,
      where: { locationId: location.id, joinDate: { gte: monthStart } },
      orderBy: { _count: { source: "desc" } },
      take: 5,
    }),
  ]);

  const opens = openRate.filter((m) => m.openedAt).length;
  const sent = openRate.length;
  const openPct = sent > 0 ? Math.round((opens / sent) * 100) : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Marketing" description="Acquisition, attribution, and engagement." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">New members MTD</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums">{signupsMtd}</div>
        </Card>
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Active visitors</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums">{visitorsCount}</div>
        </Card>
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Email open rate</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums">{openPct == null ? "—" : `${openPct}%`}</div>
        </Card>
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Emails sent MTD</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums">{sent}</div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Top member sources (MTD)" />
        {sourceBreakdown.length === 0 ? (
          <EmptyState icon={<Megaphone className="h-6 w-6" />} title="No new members yet this month" />
        ) : (
          <ul className="mt-4 divide-y divide-apple-divider">
            {sourceBreakdown.map((s) => (
              <li key={s.source} className="flex items-center justify-between py-2 text-apple-sm">
                <span className="font-medium text-apple-text">{s.source || "(unknown)"}</span>
                <span className="text-apple-text-secondary">{s._count} new</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
