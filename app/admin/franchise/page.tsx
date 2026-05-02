import { getPrisma } from "@/lib/db";
import Link from "next/link";
import { Card, CardHeader, PageHeader, Money } from "@/components/ui";
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

  const perLocation = await Promise.all(locations.map(async (loc) => {
    const [active, mtdRevenue, visitsToday] = await Promise.all([
      prisma.member.count({ where: { locationId: loc.id, status: "ACTIVE" } }),
      prisma.invoice.aggregate({ _sum: { totalCents: true }, where: { locationId: loc.id, status: "PAID", paidAt: { gte: monthStart } } }),
      prisma.visit.count({ where: { locationId: loc.id, enteredAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } } }),
    ]);
    return { loc, active, revenue: mtdRevenue._sum?.totalCents ?? 0, visits: visitsToday };
  }));

  const totals = perLocation.reduce(
    (acc, p) => ({ active: acc.active + p.active, revenue: acc.revenue + p.revenue, visits: acc.visits + p.visits }),
    { active: 0, revenue: 0, visits: 0 }
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Franchise overview" description="Roll-up across all locations you can access." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Total active members</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums">{totals.active.toLocaleString()}</div>
        </Card>
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Revenue MTD</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums"><Money cents={totals.revenue} /></div>
        </Card>
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Visits today</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums">{totals.visits.toLocaleString()}</div>
        </Card>
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Locations</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums">{locations.length}</div>
        </Card>
      </div>

      <Card>
        <CardHeader title="By location" />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-apple-sm">
            <thead>
              <tr className="text-left text-apple-xs uppercase text-apple-text-tertiary">
                <th className="pb-2">Location</th>
                <th className="pb-2 text-right">Active members</th>
                <th className="pb-2 text-right">Revenue MTD</th>
                <th className="pb-2 text-right">Visits today</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-apple-divider">
              {perLocation.map((p) => (
                <tr key={p.loc.id}>
                  <td className="py-2 font-medium text-apple-text">{p.loc.name}</td>
                  <td className="py-2 text-right tabular-nums">{p.active.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums"><Money cents={p.revenue} /></td>
                  <td className="py-2 text-right tabular-nums">{p.visits.toLocaleString()}</td>
                  <td className="py-2 text-right">
                    <Link href={`/admin/locations/${p.loc.slug}/dashboard`} className="text-apple-xs font-medium text-apple-blue hover:underline">
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
