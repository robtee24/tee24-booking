import { Suspense } from "react";
import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { AreaChart, BarChart, DonutChart, KpiCard } from "@/components/ui/charts";
import { Calculator } from "lucide-react";
import { billingRevenueByMonth, lastNMonths, revenueByPlan } from "@/lib/chart-data";
import { adminRoutes } from "@/lib/admin/routes";
import { buildLedger, memberBalances } from "@/services/billing.service";
import { BalancesTable, LedgerTable, PlanRevenueTable } from "@/components/admin/billing/AccountingTables";
import { QueryTabs } from "@/components/admin/billing/QueryTabs";
import { LedgerFilters } from "@/components/admin/billing/LedgerFilters";

export const dynamic = "force-dynamic";

const AGING_BUCKETS = [
  { label: "Current (0-30)", min: 0, max: 30 },
  { label: "31-60", min: 31, max: 60 },
  { label: "61-90", min: 61, max: 90 },
  { label: "90+", min: 91, max: Infinity },
];

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "ledger", label: "Ledger" },
  { value: "plans", label: "Revenue by plan" },
  { value: "balances", label: "Member balances" },
];

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function AccountingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const tab = TABS.some((t) => t.value === sp.tab) ? (sp.tab as string) : "overview";
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const from = sp.from && !Number.isNaN(new Date(sp.from).getTime()) ? sp.from : isoDay(monthStart);
  const to = sp.to && !Number.isNaN(new Date(sp.to).getTime()) ? sp.to : isoDay(monthEnd);
  const rangeStart = new Date(`${from}T00:00:00`);
  const rangeEnd = new Date(`${to}T00:00:00`);
  rangeEnd.setDate(rangeEnd.getDate() + 1);

  return (
    <div className="space-y-6">
      <PageHeader title="Accounting" description="Ledger, revenue by plan, member balances, and reconciliation exports." />
      <Suspense>
        <QueryTabs defaultValue="overview" items={TABS} />
      </Suspense>

      {tab === "overview" && <Overview locationId={location.id} currency={location.currency} slug={slug} />}
      {tab === "ledger" && <Ledger slug={slug} locationId={location.id} currency={location.currency} from={from} to={to} start={rangeStart} end={rangeEnd} />}
      {tab === "plans" && <Plans slug={slug} locationId={location.id} currency={location.currency} from={from} to={to} start={rangeStart} end={rangeEnd} />}
      {tab === "balances" && <Balances slug={slug} locationId={location.id} currency={location.currency} />}
    </div>
  );
}

/* ── Overview (charts) ─────────────────────────────────────────────────── */

async function Overview({ locationId, slug }: { locationId: string; currency: string; slug: string }) {
  const prisma = getPrisma();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

  const [paidMtd, refundsMtd, chargebacks, revenue12mo, chargesAll, pastDueInvoices, byPlan] = await Promise.all([
    prisma.charge.aggregate({ _sum: { amountCents: true }, where: { locationId, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] }, createdAt: { gte: monthStart } } }),
    prisma.refund.aggregate({ _sum: { amountCents: true }, where: { status: "COMPLETED", createdAt: { gte: monthStart }, charge: { locationId } } }),
    prisma.charge.aggregate({ _sum: { amountCents: true }, where: { locationId, status: "DISPUTED", updatedAt: { gte: monthStart } } }),
    billingRevenueByMonth({ locationId, months: 12 }),
    prisma.charge.findMany({ where: { locationId, createdAt: { gte: sixMonthsAgo } }, select: { status: true, createdAt: true } }),
    prisma.invoice.findMany({ where: { locationId, status: { in: ["PAST_DUE", "FAILED"] } }, select: { totalCents: true, refundedCents: true, dueDate: true } }),
    revenueByPlan({ locationId, start: monthStart, end: new Date(now.getFullYear(), now.getMonth() + 1, 1) }),
  ]);

  const months = lastNMonths(6);
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
    return { month: m.label, rate: b.total > 0 ? Number(((b.failed / b.total) * 100).toFixed(2)) : 0 };
  });
  const refundRateData = revenue12mo.slice(-6).map((m) => ({ month: m.month, rate: m.revenue + m.refunds > 0 ? Number(((m.refunds / (m.revenue + m.refunds)) * 100).toFixed(2)) : 0 }));

  const aging = AGING_BUCKETS.map((b) => ({ name: b.label, value: 0 }));
  for (const inv of pastDueInvoices) {
    const days = Math.floor((now.getTime() - inv.dueDate.getTime()) / 86_400_000);
    const idx = AGING_BUCKETS.findIndex((b) => days >= b.min && days <= b.max);
    if (idx >= 0) aging[idx].value += (inv.totalCents - inv.refundedCents) / 100;
  }
  const totalAR = aging.reduce((s, a) => s + a.value, 0);
  const planSlices = byPlan.map((p) => ({ name: p.name, value: p.netCents / 100 })).filter((p) => p.value > 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Revenue MTD" value={`$${((paidMtd._sum.amountCents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} trend={revenue12mo.slice(-6).map((m) => ({ y: m.revenue }))} hint="gross payments" />
        <KpiCard label="Refunds MTD" value={`$${((refundsMtd._sum.amountCents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
        <KpiCard label="Chargebacks MTD" value={`$${((chargebacks._sum.amountCents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
        <KpiCard label="Outstanding AR" value={`$${totalAR.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} hint={`${pastDueInvoices.length} past due`} href={`${adminRoutes.loc.billing.payments(slug)}?tab=OVERDUE`} />
      </div>

      <Card>
        <CardHeader title="Revenue by month" subtitle="Last 12 months · net of refunds" />
        <div className="mt-4">
          <BarChart data={revenue12mo} xKey="month" series={[{ key: "revenue", label: "Revenue" }]} yFormat="currency" height={240} colorByCell />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Failed payment rate" subtitle="Last 6 months · % of attempts" />
          <div className="mt-4"><AreaChart data={failedRateData} xKey="month" series={[{ key: "rate", label: "Failed %" }]} yFormat="percent" height={200} /></div>
        </Card>
        <Card>
          <CardHeader title="Refund rate" subtitle="Refunds as % of gross" />
          <div className="mt-4"><AreaChart data={refundRateData} xKey="month" series={[{ key: "rate", label: "Refund %" }]} yFormat="percent" height={200} /></div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="AR aging" subtitle="Outstanding past-due invoices" />
          <div className="mt-2">
            {totalAR === 0 ? <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">No past-due invoices.</p> : <BarChart data={aging} xKey="name" series={[{ key: "value", label: "Outstanding" }]} yFormat="currency" height={200} colorByCell />}
          </div>
        </Card>
        <Card>
          <CardHeader title="Revenue by plan (MTD)" action={<Link href={`${adminRoutes.loc.billing.accounting(slug)}?tab=plans`} className="text-apple-xs text-apple-blue hover:underline">Details →</Link>} />
          <div className="mt-2">
            {planSlices.length === 0 ? <EmptyState icon={<Calculator className="h-6 w-6" />} title="No revenue yet this month" /> : <DonutChart data={planSlices} height={220} />}
          </div>
        </Card>
      </div>
    </>
  );
}

/* ── Ledger ───────────────────────────────────────────────────────────── */

async function Ledger({ slug, locationId, currency, from, to, start, end }: { slug: string; locationId: string; currency: string; from: string; to: string; start: Date; end: Date }) {
  const rows = await buildLedger({ locationId, start, end });
  const totals = rows.reduce(
    (acc, r) => {
      acc.net += r.amountCents * (r.totalCents < 0 ? -1 : 1);
      acc.tax += r.taxCents * (r.totalCents < 0 ? -1 : 1);
      acc.surcharge += r.surchargeCents * (r.totalCents < 0 ? -1 : 1);
      acc.total += r.totalCents;
      return acc;
    },
    { net: 0, tax: 0, surcharge: 0, total: 0 },
  );

  const sign = (r: { totalCents: number }) => (r.totalCents < 0 ? -1 : 1);
  const tableRows = rows.map((r) => ({
    id: r.id,
    date: r.date.toISOString(),
    type: r.type,
    memberId: r.memberId,
    memberName: r.memberName,
    description: r.description,
    method: r.method,
    netCents: r.amountCents * sign(r),
    taxCents: r.taxCents * sign(r),
    totalCents: r.totalCents,
    glCode: r.glCode,
    incomeCategory: r.incomeCategory,
    reference: r.reference,
    invoiceId: r.invoiceId,
    invoiceNumber: r.invoiceNumber,
  }));

  return (
    <>
      <Suspense>
        <LedgerFilters slug={slug} from={from} to={to} />
      </Suspense>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Net revenue" value={`$${(totals.net / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} hint="excl. tax & surcharge" />
        <KpiCard label="Tax collected" value={`$${(totals.tax / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
        <KpiCard label="Card surcharges" value={`$${(totals.surcharge / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
        <KpiCard label="Total collected" value={`$${(totals.total / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} hint={`${rows.length} transactions`} />
      </div>
      <LedgerTable slug={slug} rows={tableRows} currency={currency} />
    </>
  );
}

/* ── Revenue by plan ─────────────────────────────────────────────────── */

async function Plans({ slug, locationId, currency, from, to, start, end }: { slug: string; locationId: string; currency: string; from: string; to: string; start: Date; end: Date }) {
  const rows = await revenueByPlan({ locationId, start, end });
  return (
    <>
      <Suspense>
        <LedgerFilters slug={slug} from={from} to={to} />
      </Suspense>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PlanRevenueTable rows={rows} currency={currency} />
        </div>
        <Card>
          <CardHeader title="Share of net revenue" />
          <div className="mt-2">{rows.length === 0 ? <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">Nothing yet.</p> : <DonutChart data={rows.map((r) => ({ name: r.name, value: r.netCents / 100 }))} height={240} />}</div>
        </Card>
      </div>
    </>
  );
}

/* ── Member balances ─────────────────────────────────────────────────── */

async function Balances({ slug, locationId, currency }: { slug: string; locationId: string; currency: string }) {
  const rows = await memberBalances(locationId);
  const owed = rows.reduce((s, r) => s + Math.max(0, r.outstandingCents), 0);
  const credit = rows.reduce((s, r) => s + Math.max(0, r.creditCents), 0);
  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiCard label="Owed to you" value={`$${(owed / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} hint="open invoices" />
        <KpiCard label="Member credit" value={`$${(credit / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} hint="unused balance" />
        <KpiCard label="Members with balance" value={rows.length} />
      </div>
      <BalancesTable slug={slug} rows={rows} currency={currency} />
    </>
  );
}
