import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { AreaChart, BarChart, DonutChart, KpiCard } from "@/components/ui/charts";
import { Calculator } from "lucide-react";
import { lastNMonths, revenueByMonth } from "@/lib/chart-data";

export const dynamic = "force-dynamic";

const AGING_BUCKETS = [
  { label: "Current (0-30)", min: 0, max: 30 },
  { label: "31-60", min: 31, max: 60 },
  { label: "61-90", min: 61, max: 90 },
  { label: "90+", min: 91, max: Infinity },
];

export default async function AccountingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

  const [
    paidMtd,
    refundsMtd,
    chargebacks,
    breakdown,
    revenue12mo,
    refundsByMonth,
    chargesAll,
    pastDueInvoices,
  ] = await Promise.all([
    prisma.charge.aggregate({
      _sum: { amountCents: true },
      where: { locationId: location.id, status: "SUCCEEDED", createdAt: { gte: monthStart } },
    }),
    prisma.refund.aggregate({
      _sum: { amountCents: true },
      where: { createdAt: { gte: monthStart }, charge: { locationId: location.id } },
    }),
    prisma.charge.aggregate({
      _sum: { amountCents: true },
      where: { locationId: location.id, status: "DISPUTED", updatedAt: { gte: monthStart } },
    }),
    prisma.invoice.groupBy({
      by: ["description"],
      _sum: { totalCents: true },
      where: { locationId: location.id, status: "PAID", paidAt: { gte: monthStart } },
      orderBy: { _sum: { totalCents: "desc" } },
      take: 10,
    }),
    revenueByMonth({ locationId: location.id, months: 12 }),
    prisma.refund.findMany({
      where: { createdAt: { gte: sixMonthsAgo }, charge: { locationId: location.id } },
      select: { amountCents: true, createdAt: true },
    }),
    prisma.charge.findMany({
      where: { locationId: location.id, createdAt: { gte: sixMonthsAgo } },
      select: { status: true, createdAt: true },
    }),
    prisma.invoice.findMany({
      where: { locationId: location.id, status: { in: ["PAST_DUE", "FAILED"] } },
      select: { totalCents: true, dueDate: true },
    }),
  ]);

  // Refund + failed-rate trend by month
  const months = lastNMonths(6);
  const refundByKey = new Map<string, number>();
  for (const m of months) refundByKey.set(m.iso, 0);
  for (const r of refundsByMonth) {
    const k = `${r.createdAt.getFullYear()}-${String(r.createdAt.getMonth() + 1).padStart(2, "0")}`;
    if (refundByKey.has(k)) refundByKey.set(k, (refundByKey.get(k) ?? 0) + r.amountCents);
  }
  const failedByKey = new Map<string, { failed: number; total: number }>();
  for (const m of months) failedByKey.set(m.iso, { failed: 0, total: 0 });
  for (const c of chargesAll) {
    const k = `${c.createdAt.getFullYear()}-${String(c.createdAt.getMonth() + 1).padStart(2, "0")}`;
    const b = failedByKey.get(k);
    if (b) {
      b.total++;
      if (c.status === "FAILED") b.failed++;
    }
  }
  const failedRateData = months.map((m) => {
    const b = failedByKey.get(m.iso)!;
    return {
      month: m.label,
      rate: b.total > 0 ? Number(((b.failed / b.total) * 100).toFixed(2)) : 0,
    };
  });
  const refundRateData = months.map((m) => {
    const rev = revenue12mo.find((r) => r.month === m.label)?.revenue ?? 0;
    const refundDollars = (refundByKey.get(m.iso) ?? 0) / 100;
    return {
      month: m.label,
      rate: rev > 0 ? Number(((refundDollars / rev) * 100).toFixed(2)) : 0,
    };
  });

  // AR aging
  const aging = AGING_BUCKETS.map((b) => ({ name: b.label, value: 0 }));
  for (const inv of pastDueInvoices) {
    const days = Math.floor((now.getTime() - inv.dueDate.getTime()) / 86_400_000);
    const idx = AGING_BUCKETS.findIndex((b) => days >= b.min && days <= b.max);
    if (idx >= 0) aging[idx].value += inv.totalCents / 100;
  }

  // Revenue by line item
  const linesData = breakdown
    .map((b: any) => ({
      name: (b.description as string | null) ?? "(uncategorized)",
      value: (b._sum?.totalCents ?? 0) / 100,
    }))
    .filter((b) => b.value > 0);

  const totalAR = aging.reduce((s, a) => s + a.value, 0);
  const revTrend = revenue12mo.slice(-6).map((m) => ({ y: m.revenue }));

  return (
    <div className="space-y-6">
      <PageHeader title="Accounting" description="Revenue, refunds, AR aging, and reconciliation." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="Revenue MTD"
          value={`$${((paidMtd._sum?.amountCents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          trend={revTrend}
        />
        <KpiCard
          label="Refunds MTD"
          value={`$${((refundsMtd._sum?.amountCents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <KpiCard
          label="Chargebacks MTD"
          value={`$${((chargebacks._sum?.amountCents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <KpiCard
          label="Outstanding AR"
          value={`$${totalAR.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          hint={`${pastDueInvoices.length} past due`}
        />
      </div>

      <Card>
        <CardHeader title="Revenue by month" subtitle="Last 12 months · paid charges" />
        <div className="mt-4">
          <BarChart
            data={revenue12mo}
            xKey="month"
            series={[{ key: "revenue", label: "Revenue" }]}
            yFormatter={(v) => `$${v.toLocaleString()}`}
            height={240}
            colorByCell
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Failed payment rate" subtitle="Last 6 months · % of attempts" />
          <div className="mt-4">
            <AreaChart
              data={failedRateData}
              xKey="month"
              series={[{ key: "rate", label: "Failed %" }]}
              yFormatter={(v) => `${v}%`}
              height={200}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Refund rate" subtitle="Refunds as % of revenue" />
          <div className="mt-4">
            <AreaChart
              data={refundRateData}
              xKey="month"
              series={[{ key: "rate", label: "Refund %" }]}
              yFormatter={(v) => `${v}%`}
              height={200}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="AR aging" subtitle="Outstanding past-due invoices" />
          <div className="mt-2">
            {totalAR === 0 ? (
              <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">No past-due invoices.</p>
            ) : (
              <BarChart
                data={aging}
                xKey="name"
                series={[{ key: "value", label: "Outstanding" }]}
                yFormatter={(v) => `$${v.toLocaleString()}`}
                height={200}
                colorByCell
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Top revenue lines (MTD)" />
          <div className="mt-2">
            {linesData.length === 0 ? (
              <EmptyState icon={<Calculator className="h-6 w-6" />} title="No revenue yet this month" />
            ) : (
              <DonutChart data={linesData} height={220} />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
