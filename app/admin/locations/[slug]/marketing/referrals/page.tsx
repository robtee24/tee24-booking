import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader, Money, StatusBadge } from "@/components/ui";
import { AreaChart, BarChart, KpiCard } from "@/components/ui/charts";
import { Gift } from "lucide-react";
import { lastNMonths } from "@/lib/chart-data";

export const dynamic = "force-dynamic";

export default async function ReferralsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const [topReferrers, pendingPayouts, paidYtd, totalReferred, payoutHistory] = await Promise.all([
    prisma.referral.groupBy({
      by: ["referrerId"],
      _count: { _all: true },
      _sum: { earnedCents: true },
      orderBy: { _count: { referrerId: "desc" } },
      take: 10,
    }),
    prisma.referralPayout.findMany({
      where: { status: { in: ["PENDING", "APPROVED"] } },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.referralPayout.aggregate({
      _sum: { amountCents: true },
      where: { status: { in: ["SENT", "PAID"] }, paidAt: { gte: yearStart } },
    }),
    prisma.referral.count(),
    prisma.referralPayout.findMany({
      where: { status: { in: ["SENT", "PAID"] }, paidAt: { gte: sixMonthsAgo } },
      select: { amountCents: true, paidAt: true },
    }),
  ]);

  const referrerIds = topReferrers.map((t) => t.referrerId).filter(Boolean) as string[];
  const referrers = referrerIds.length > 0
    ? await prisma.member.findMany({
        where: { id: { in: referrerIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const refById = new Map(referrers.map((r) => [r.id, r]));

  const leaderboard = topReferrers
    .map((t) => {
      const m = refById.get(t.referrerId!);
      if (!m) return null;
      return {
        name: `${m.firstName} ${m.lastName}`,
        referrals: (t._count as any)?._all ?? 0,
        earned: ((t._sum?.earnedCents ?? 0) / 100),
      };
    })
    .filter((x): x is { name: string; referrals: number; earned: number } => Boolean(x));

  const months = lastNMonths(6);
  const payoutTrend = months.map((m) => {
    const cents = payoutHistory
      .filter((p) => p.paidAt && p.paidAt >= m.start && p.paidAt < m.end)
      .reduce((sum, p) => sum + p.amountCents, 0);
    return { month: m.label, payouts: Math.round(cents / 100) };
  });
  const payoutSpark = payoutTrend.map((m) => ({ y: m.payouts }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Referrals"
        description="Each member gets a unique code & URL. Earn payments (PayPal) or membership credit."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="Total referrals"
          value={totalReferred.toLocaleString()}
        />
        <KpiCard
          label="Active referrers"
          value={topReferrers.length.toLocaleString()}
        />
        <KpiCard
          label="Pending payouts"
          value={pendingPayouts.length.toLocaleString()}
          hint={`$${(pendingPayouts.reduce((s, p) => s + p.amountCents, 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <KpiCard
          label="Paid YTD"
          value={`$${((paidYtd._sum?.amountCents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          trend={payoutSpark}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Payouts trend" subtitle="Last 6 months" />
          <div className="mt-4">
            <AreaChart
              data={payoutTrend}
              xKey="month"
              series={[{ key: "payouts", label: "Paid" }]}
              yFormatter={(v) => `$${v.toLocaleString()}`}
              height={220}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Top referrers" subtitle="By number of successful referrals" />
          <div className="mt-4">
            {leaderboard.length === 0 ? (
              <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">
                No referrals yet.
              </p>
            ) : (
              <BarChart
                data={leaderboard}
                xKey="name"
                series={[{ key: "referrals", label: "Referrals" }]}
                layout="vertical"
                height={Math.max(220, leaderboard.length * 28)}
              />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Pending payouts" />
        {pendingPayouts.length === 0 ? (
          <EmptyState
            icon={<Gift className="h-6 w-6" />}
            title="No pending payouts"
            description="Payouts are batched at month-end and require admin approval before sending via PayPal."
          />
        ) : (
          <ul className="mt-4 divide-y divide-apple-divider">
            {pendingPayouts.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2 text-apple-sm">
                <div>
                  <div className="font-medium text-apple-text">{p.referrerId}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">
                    {new Date(p.periodStart).toLocaleDateString()} – {new Date(p.periodEnd).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Money cents={p.amountCents} className="font-medium" />
                  <StatusBadge status={p.status} size="sm" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
