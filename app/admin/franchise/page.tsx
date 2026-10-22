import { getPrisma } from "@/lib/db";
import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader, Money } from "@/components/ui";
import { BarChart, DonutChart, KpiCard } from "@/components/ui/charts";
import { getAccessibleLocationIds } from "@/lib/access";
import { adminRoutes } from "@/lib/admin/routes";
import { LocationRowActions } from "@/components/admin/staff/LocationRowActions";
import { DateRangeSelect, parseRange, rangeBounds } from "@/components/admin/staff/DateRangeSelect";

export const dynamic = "force-dynamic";

export default async function FranchisePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const prisma = getPrisma();
  const sp = await searchParams;
  const locationIds = await getAccessibleLocationIds();
  const locations = await prisma.location.findMany({
    where: { id: { in: locationIds } },
    orderBy: { createdAt: "asc" }, // first created = HQ
  });
  const hqId = locations[0]?.id ?? null;

  const now = new Date();
  const range = parseRange(sp.range, "mtd");
  const bounds = rangeBounds(range, now);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  const perLocation = await Promise.all(
    locations.map(async (loc) => {
      const [active, visitor, frozen, rangeRevenue, newMembers, visitsToday, churnAtRisk, leads30d] = await Promise.all([
        prisma.member.count({ where: { locationId: loc.id, status: "ACTIVE" } }),
        prisma.member.count({ where: { locationId: loc.id, status: "VISITOR" } }),
        prisma.member.count({ where: { locationId: loc.id, status: "FROZEN" } }),
        prisma.invoice.aggregate({
          _sum: { totalCents: true },
          where: { locationId: loc.id, status: { in: ["PAID", "PARTIALLY_REFUNDED"] }, paidAt: { gte: bounds.start, lt: bounds.end } },
        }),
        prisma.member.count({ where: { locationId: loc.id, OR: [{ joinDate: { gte: bounds.start, lt: bounds.end } }, { joinDate: null, createdAt: { gte: bounds.start, lt: bounds.end } }] } }),
        prisma.visit.count({ where: { locationId: loc.id, enteredAt: { gte: todayStart } } }),
        prisma.churnRiskScore
          .count({ where: { member: { locationId: loc.id }, score: { gte: 60 } } })
          .catch(() => 0),
        prisma.visitor.count({ where: { locationId: loc.id, createdAt: { gte: thirtyDaysAgo } } }).catch(() => 0),
      ]);
      return {
        loc,
        active,
        visitor,
        frozen,
        revenue: rangeRevenue._sum?.totalCents ?? 0,
        newMembers,
        visits: visitsToday,
        churnAtRisk,
        leads30d,
      };
    }),
  );
  const unassignedLeads = await prisma.visitor.count({ where: { locationId: null, createdAt: { gte: thirtyDaysAgo } } }).catch(() => 0);

  const totals = perLocation.reduce(
    (acc, p) => ({
      active: acc.active + p.active,
      visitor: acc.visitor + p.visitor,
      frozen: acc.frozen + p.frozen,
      revenue: acc.revenue + p.revenue,
      newMembers: acc.newMembers + p.newMembers,
      visits: acc.visits + p.visits,
      churnAtRisk: acc.churnAtRisk + p.churnAtRisk,
      leads30d: acc.leads30d + p.leads30d,
    }),
    { active: 0, visitor: 0, frozen: 0, revenue: 0, newMembers: 0, visits: 0, churnAtRisk: 0, leads30d: unassignedLeads },
  );

  const revenueByLocation = perLocation.map((p) => ({
    name: p.loc.name,
    revenue: Math.round(p.revenue / 100),
  }));
  const membersByLocation = perLocation.map((p) => ({
    name: p.loc.name,
    members: p.active,
    new: p.newMembers,
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
        actions={<DateRangeSelect value={range} basePath={adminRoutes.franchise()} />}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Active members" value={totals.active.toLocaleString()} hint={`${totals.newMembers} new · ${bounds.label.toLowerCase()}`} />
        <KpiCard
          label={range === "mtd" ? "Revenue MTD" : `Revenue · ${bounds.label}`}
          value={`$${(totals.revenue / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          hint="Paid invoices"
        />
        <KpiCard label="New leads (30d)" value={totals.leads30d.toLocaleString()} hint={unassignedLeads ? `${unassignedLeads} not yet assigned to a location` : "Visitors captured"} />
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
            subtitle={bounds.label}
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
                yFormat="currency"
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
        <CardHeader title="Members by location" subtitle={`Active members · new in ${bounds.label.toLowerCase()}`} />
        <div className="mt-4">
          {membersByLocation.length === 0 ? (
            <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">
              No data.
            </p>
          ) : (
            <BarChart
              data={membersByLocation}
              xKey="name"
              series={[{ key: "members", label: "Active members" }, { key: "new", label: "New" }]}
              height={Math.max(220, membersByLocation.length * 44)}
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
                <th className="pb-2 text-right">Revenue</th>
                <th className="pb-2 text-right">New</th>
                <th className="pb-2 text-right">Leads 30d</th>
                <th className="pb-2 text-right">Visits today</th>
                <th className="pb-2 text-right">At risk</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-apple-divider">
              {perLocation.map((p) => (
                <tr key={p.loc.id}>
                  <td className="py-2 font-medium text-apple-text">
                    <div className="flex items-center gap-2">
                      <Link href={adminRoutes.loc.dashboard(p.loc.slug)} className="hover:text-apple-blue">{p.loc.name}</Link>
                      {p.loc.id === hqId && <Badge tone="info" size="sm">HQ</Badge>}
                      {p.loc.disabled && <Badge tone="danger" size="sm">Disabled</Badge>}
                    </div>
                  </td>
                  <td className="py-2 text-right tabular-nums">{p.active.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">{p.visitor.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">{p.frozen.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">
                    <Money cents={p.revenue} />
                  </td>
                  <td className="py-2 text-right tabular-nums">{p.newMembers.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">{p.leads30d.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">{p.visits.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">
                    <span className={p.churnAtRisk > 0 ? "text-apple-orange font-semibold" : ""}>
                      {p.churnAtRisk}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <LocationRowActions slug={p.loc.slug} name={p.loc.name} />
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
