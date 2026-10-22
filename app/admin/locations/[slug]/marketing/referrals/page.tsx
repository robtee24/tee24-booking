import { getPrisma } from "@/lib/db";
import Link from "next/link";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui";
import { AreaChart, BarChart, KpiCard } from "@/components/ui/charts";
import { Settings2 } from "lucide-react";
import { lastNMonths } from "@/lib/chart-data";
import { adminRoutes } from "@/lib/admin/routes";
import { getActorContext } from "@/lib/actor";
import { can } from "@/lib/permissions";
import { getMarketingSettings } from "@/services/marketing.service";
import { ReferralsClient, type ReferralsData } from "@/components/admin/marketing/ReferralsClient";

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

  // Grouped referral data for the client (mirrors GET /api/admin/referrals).
  const [allReferrals, allPayouts, referredMembers, settings, actor] = await Promise.all([
    prisma.referral.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.referralPayout.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.member.findMany({ where: { locationId: location.id, referredById: { not: null } }, select: { id: true, firstName: true, lastName: true, referredById: true, joinDate: true }, take: 200 }),
    getMarketingSettings(location.organizationId),
    getActorContext(),
  ]);
  const referredIds = new Set(allReferrals.map((r) => r.referredMemberId));
  const unmatched = referredMembers.filter((m) => !referredIds.has(m.id));
  const miniIds = Array.from(new Set([...allReferrals.map((r) => r.referrerId), ...allReferrals.map((r) => r.referredMemberId), ...allPayouts.map((p) => p.referrerId)]));
  const minis = miniIds.length
    ? await prisma.member.findMany({ where: { id: { in: miniIds } }, select: { id: true, firstName: true, lastName: true, email: true, status: true, referralCode: true, paypalAccount: { select: { paypalEmail: true } } } })
    : [];
  const miniById = new Map(minis.map((m) => [m.id, m]));
  const payoutRows = allPayouts.map((p) => ({ ...p, periodStart: p.periodStart.toISOString(), periodEnd: p.periodEnd.toISOString(), createdAt: p.createdAt.toISOString(), paidAt: p.paidAt?.toISOString() ?? null, referrer: miniById.get(p.referrerId) ?? null }));
  const payoutRowById = new Map(payoutRows.map((p) => [p.id, p]));
  const referralsData: ReferralsData = {
    items: allReferrals.map((r) => {
      const payout = r.payoutId ? payoutRowById.get(r.payoutId) ?? null : null;
      const state: "pending" | "confirmed" | "paid" = r.earnedKind === "CREDIT" ? "paid" : !payout ? "pending" : ["SENT", "PAID"].includes(payout.status) ? "paid" : "confirmed";
      return { ...r, createdAt: r.createdAt.toISOString(), state, payout, referrer: miniById.get(r.referrerId) ?? null, referred: miniById.get(r.referredMemberId) ?? null };
    }),
    payouts: payoutRows,
    unmatched: unmatched.map((m) => ({ ...m, joinDate: m.joinDate?.toISOString() ?? null })),
    paypalConfigured: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
  };
  const rewardLabel = !settings.referral.enabled
    ? "program paused"
    : `$${(settings.referral.rewardCents / 100).toFixed(0)} ${settings.referral.rewardKind === "CREDIT" ? "account credit" : "PayPal payment"}`;
  const canSendPayouts = can(actor, "marketing.send-payouts", { locationId: location.id });

  const leaderboard = topReferrers
    .map((t) => {
      const m = refById.get(t.referrerId!);
      if (!m) return null;
      return {
        name: `${m.firstName} ${m.lastName}`,
        referrals: t._count._all ?? 0,
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
        actions={
          <Link href={adminRoutes.loc.marketing.settings(slug)}>
            <Button variant="secondary" iconLeft={<Settings2 className="h-4 w-4" />}>Reward settings</Button>
          </Link>
        }
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
              yFormat="currency"
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

      <ReferralsClient initial={referralsData} rewardLabel={rewardLabel} canSendPayouts={canSendPayouts} />
    </div>
  );
}
