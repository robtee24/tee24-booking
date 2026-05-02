import { getPrisma } from "@/lib/db";
import Link from "next/link";
import { Card, CardHeader, PageHeader, Money } from "@/components/ui";
import { BarChart, DonutChart, KpiCard } from "@/components/ui/charts";
import { getAccessibleLocationIds } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function FranchisePage() {
  const prisma = getPrisma();
  const locationIds = await getAccessibleLocationIds();
  const locations = await prisma.location.findMany({
    where: { id: { in: locationIds } },
    orderBy: { name: "asc" },
  });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const perLocation = await Promise.all(
    locations.map(async (loc) => {
      const [active, visitor, frozen, mtdRevenue, visitsToday, churnAtRisk] = await Promise.all([
        prisma.member.count({ where: { locationId: loc.id, status: "ACTIVE" } }),
        prisma.member.count({ where: { locationId: loc.id, status: "VISITOR" } }),
        prisma.member.count({ where: { locationId: loc.id, status: "FROZEN" } }),
        prisma.invoice.aggregate({
          _sum: { totalCents: true },
          where: { locationId: loc.id, status: "PAID", paidAt: { gte: monthStart } },
        }),
        prisma.visit.count({ where: { locationId: loc.id, enteredAt: { gte: todayStart } } }),
        prisma.churnRiskScore
          .count({ where: { member: { locationId: loc.id }, score: { gte: 60 } } })
          .catch(() => 0),
      ]);
      return {
        loc,
        active,
        visitor,
        frozen,
        revenue: mtdRevenue._sum?.totalCents ?? 0,
        visits: visitsToday,
        churnAtRisk,
      };
    }),
  );

  const totals = perLocation.reduce(
    (acc, p) => ({
      active: acc.active + p.active,
      visitor: acc.visitor + p.visitor,
      frozen: acc.frozen + p.frozen,
      revenue: acc.revenue + p.revenue,
      visits: acc.visits + p.visits,
      churnAtRisk: acc.churnAtRisk + p.churnAtRisk,
    }),
    { active: 0, visitor: 0, frozen: 0, revenue: 0, visits: 0, churnAtRisk: 0 },
  );

  const revenueByLocation = perLocation.map((p) => ({
    name: p.loc.name,
    revenue: Math.round(p.revenue / 100),
  }));
  const membersByLocation = perLocation.map((p) => ({
    name: p.loc.name,
    members: p.active,
  }));
  const statusMix = [
    { name: "ACTIVE", value: totals.active },
    { name: "VISITOR", value: totals.visitor },
    { name: "FROZEN", value: totals.frozen },
  ].filter((s) => s.value > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Franchise overview"
        description="Roll-up across all locations you can access."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Active members" value={totals.active.toLocaleString()} />
        <KpiCard
          label="Revenue MTD"
          value={`$${(totals.revenue / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <KpiCard label="Visits today" value={totals.visits.toLocaleString()} />
        <KpiCard
          label="Churn at risk"
          value={totals.churnAtRisk.toLocaleString()}
          hint="Members with risk ≥ 60%"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Revenue by location"
            subtitle="Month-to-date"
          />
          <div className="mt-4">
            {revenueByLocation.length === 0 ? (
              <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">
                No locations accessible.
              </p>
            ) : (
              <BarChart
                data={revenueByLocation}
                xKey="name"
                series={[{ key: "revenue", label: "Revenue" }]}
                yFormatter={(v) => `$${v.toLocaleString()}`}
                height={240}
                colorByCell
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Member status mix" subtitle="Across all locations" />
          <div className="mt-2">
            {statusMix.length === 0 ? (
              <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">
                No members yet.
              </p>
            ) : (
              <DonutChart
                data={statusMix}
                useStatusColors
                centerLabel="Members"
                centerValue={(totals.active + totals.visitor + totals.frozen).toLocaleString()}
                height={240}
              />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Members by location" subtitle="Active members" />
        <div className="mt-4">
          {membersByLocation.length === 0 ? (
            <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">
              No data.
            </p>
          ) : (
            <BarChart
              data={membersByLocation}
              xKey="name"
              series={[{ key: "members", label: "Active members" }]}
              height={Math.max(220, membersByLocation.length * 36)}
              layout="vertical"
            />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="By location · detail" />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-apple-sm">
            <thead>
              <tr className="text-left text-apple-xs uppercase text-apple-text-tertiary">
                <th className="pb-2">Location</th>
                <th className="pb-2 text-right">Active</th>
                <th className="pb-2 text-right">Visitors</th>
                <th className="pb-2 text-right">Frozen</th>
                <th className="pb-2 text-right">Revenue MTD</th>
                <th className="pb-2 text-right">Visits today</th>
                <th className="pb-2 text-right">At risk</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-apple-divider">
              {perLocation.map((p) => (
                <tr key={p.loc.id}>
                  <td className="py-2 font-medium text-apple-text">{p.loc.name}</td>
                  <td className="py-2 text-right tabular-nums">{p.active.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">{p.visitor.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">{p.frozen.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">
                    <Money cents={p.revenue} />
                  </td>
                  <td className="py-2 text-right tabular-nums">{p.visits.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">
                    <span className={p.churnAtRisk > 0 ? "text-apple-orange font-semibold" : ""}>
                      {p.churnAtRisk}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <Link
                      href={`/admin/locations/${p.loc.slug}/dashboard`}
                      className="text-apple-xs font-medium text-apple-blue hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
