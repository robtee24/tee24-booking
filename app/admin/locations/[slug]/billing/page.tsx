import { getPrisma } from "@/lib/db";
import { Card, CardHeader, PageHeader, Money, StatusBadge } from "@/components/ui";
import { AreaChart, BarChart, DonutChart, KpiCard } from "@/components/ui/charts";
import { revenueByMonth } from "@/lib/chart-data";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function BillingOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [paidMtd, paidPrev, scheduledMtd, overdue, upcoming, recentPayments, revenue6mo, statusMix] = await Promise.all([
    prisma.invoice.aggregate({ _sum: { totalCents: true }, where: { locationId: location.id, status: "PAID", paidAt: { gte: monthStart } } }),
    prisma.invoice.aggregate({ _sum: { totalCents: true }, where: { locationId: location.id, status: "PAID", paidAt: { gte: lastMonthStart, lt: monthStart } } }),
    prisma.invoice.aggregate({ _sum: { totalCents: true }, where: { locationId: location.id, status: "SCHEDULED", dueDate: { gte: monthStart, lt: new Date(now.getFullYear(), now.getMonth() + 1, 1) } } }),
    prisma.invoice.aggregate({ _sum: { totalCents: true }, _count: true, where: { locationId: location.id, status: { in: ["PAST_DUE", "FAILED"] } } }),
    prisma.invoice.findMany({
      where: { locationId: location.id, status: "SCHEDULED", dueDate: { gte: now } },
      orderBy: { dueDate: "asc" },
      take: 5,
      include: { member: { select: { firstName: true, lastName: true, id: true } } },
    }),
    prisma.invoice.findMany({
      where: { locationId: location.id, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } },
      orderBy: { paidAt: "desc" },
      take: 5,
      include: { member: { select: { firstName: true, lastName: true, id: true } } },
    }),
    revenueByMonth({ locationId: location.id, months: 6 }),
    prisma.invoice.groupBy({
      by: ["status"],
      where: { locationId: location.id, dueDate: { gte: lastMonthStart } },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
  ]);

  const revenueTrend = revenue6mo.map((m) => ({ y: m.revenue }));
  const deltaVsPrev =
    paidPrev._sum?.totalCents && paidPrev._sum.totalCents > 0
      ? ((((paidMtd._sum?.totalCents ?? 0) - paidPrev._sum.totalCents) / paidPrev._sum.totalCents) * 100)
      : undefined;

  const invoiceStatusSlices = statusMix
    .map((s: any) => ({ name: String(s.status), value: s._count?._all ?? 0 }))
    .filter((s) => s.value > 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" description="Income, recurring revenue, and overdue accounts." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="Paid MTD"
          value={`$${((paidMtd._sum?.totalCents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          delta={deltaVsPrev}
          trend={revenueTrend}
        />
        <KpiCard
          label="Scheduled this month"
          value={`$${((scheduledMtd._sum?.totalCents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <KpiCard
          label="Overdue"
          value={`$${((overdue._sum?.totalCents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          hint={`${overdue._count} invoice${overdue._count === 1 ? "" : "s"}`}
        />
        <KpiCard
          label="Last month"
          value={`$${((paidPrev._sum?.totalCents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Revenue trend" subtitle="Last 6 months · paid charges" />
          <div className="mt-4">
            <AreaChart
              data={revenue6mo}
              xKey="month"
              series={[{ key: "revenue", label: "Revenue" }]}
              yFormatter={(v) => `$${v.toLocaleString()}`}
              height={220}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Invoice status" subtitle="Last 60 days" />
          <div className="mt-2">
            {invoiceStatusSlices.length === 0 ? (
              <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">No invoices yet.</p>
            ) : (
              <DonutChart data={invoiceStatusSlices} useStatusColors height={220} />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Quick links" />
        <div className="mt-3 flex flex-wrap gap-2 text-apple-sm">
          <Link href={`/admin/locations/${slug}/billing/payments`} className="rounded-apple-pill border border-apple-border bg-white px-4 py-2 font-medium text-apple-text hover:bg-apple-fill-secondary">All payments →</Link>
          <Link href={`/admin/locations/${slug}/billing/recurring`} className="rounded-apple-pill border border-apple-border bg-white px-4 py-2 font-medium text-apple-text hover:bg-apple-fill-secondary">Recurring →</Link>
          <Link href={`/admin/locations/${slug}/billing/discounts`} className="rounded-apple-pill border border-apple-border bg-white px-4 py-2 font-medium text-apple-text hover:bg-apple-fill-secondary">Discounts →</Link>
          <Link href={`/admin/locations/${slug}/billing/accounting`} className="rounded-apple-pill border border-apple-border bg-white px-4 py-2 font-medium text-apple-text hover:bg-apple-fill-secondary">Accounting →</Link>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming invoices" />
          {upcoming.length === 0 ? <p className="mt-3 text-apple-sm text-apple-text-tertiary">Nothing due soon.</p> : (
            <ul className="mt-3 divide-y divide-apple-divider">
              {upcoming.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2 text-apple-sm">
                  <div>
                    <div className="font-medium text-apple-text">{i.member.firstName} {i.member.lastName}</div>
                    <div className="text-apple-xs text-apple-text-tertiary">Due {new Date(i.dueDate).toLocaleDateString()}</div>
                  </div>
                  <Money cents={i.totalCents} className="font-medium" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent payments" />
          {recentPayments.length === 0 ? <p className="mt-3 text-apple-sm text-apple-text-tertiary">No recent payments.</p> : (
            <ul className="mt-3 divide-y divide-apple-divider">
              {recentPayments.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2 text-apple-sm">
                  <div>
                    <div className="font-medium text-apple-text">{i.member.firstName} {i.member.lastName}</div>
                    <div className="text-apple-xs text-apple-text-tertiary">{i.paidAt && new Date(i.paidAt).toLocaleDateString()}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Money cents={i.totalCents} className="font-medium" />
                    <StatusBadge status={i.status} size="sm" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
