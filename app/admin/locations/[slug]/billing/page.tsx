import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { Card, CardHeader, PageHeader, Money, StatusBadge } from "@/components/ui";
import { AreaChart, DonutChart, KpiCard } from "@/components/ui/charts";
import { billingRevenueByMonth } from "@/lib/chart-data";
import { adminRoutes } from "@/lib/admin/routes";
import { OVERDUE_STATUSES, queryInvoices } from "@/services/billing.service";
import { InvoiceTable, toInvoiceTableRow } from "@/components/admin/billing/InvoiceTable";
import { SquareConnectCallout } from "@/components/admin/billing/SquareConnectCallout";
import { squareStatusPayload } from "@/app/api/admin/billing/_shared";

export const dynamic = "force-dynamic";

function money(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default async function BillingOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [paidMtd, paidPrev, scheduledMtd, overdueAgg, overdueRows, upcoming, recentPayments, revenue12mo, statusMix, activeSubs, cardsExpiring] = await Promise.all([
    prisma.invoice.aggregate({ _sum: { totalCents: true, refundedCents: true }, _count: true, where: { locationId: location.id, status: { in: ["PAID", "PARTIALLY_REFUNDED"] }, paidAt: { gte: monthStart, lt: nextMonthStart } } }),
    prisma.invoice.aggregate({ _sum: { totalCents: true }, where: { locationId: location.id, status: { in: ["PAID", "PARTIALLY_REFUNDED"] }, paidAt: { gte: lastMonthStart, lt: monthStart } } }),
    prisma.invoice.aggregate({ _sum: { totalCents: true }, _count: true, where: { locationId: location.id, status: "SCHEDULED", dueDate: { gte: monthStart, lt: nextMonthStart } } }),
    prisma.invoice.aggregate({ _sum: { totalCents: true, refundedCents: true }, _count: true, where: { locationId: location.id, status: { in: [...OVERDUE_STATUSES] } } }),
    queryInvoices({ locationId: location.id, tab: "OVERDUE", take: 50 }),
    prisma.invoice.findMany({
      where: { locationId: location.id, status: "SCHEDULED", dueDate: { gte: now } },
      orderBy: { dueDate: "asc" },
      take: 6,
      include: { member: { select: { firstName: true, lastName: true, id: true } } },
    }),
    prisma.invoice.findMany({
      where: { locationId: location.id, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } },
      orderBy: { paidAt: "desc" },
      take: 6,
      include: { member: { select: { firstName: true, lastName: true, id: true } } },
    }),
    billingRevenueByMonth({ locationId: location.id, months: 12 }),
    prisma.invoice.groupBy({ by: ["status"], where: { locationId: location.id, dueDate: { gte: lastMonthStart } }, _count: { _all: true } }),
    prisma.membershipSubscription.aggregate({ _sum: { priceCents: true }, _count: true, where: { locationId: location.id, status: { in: ["ACTIVE", "CANCEL_SCHEDULED"] }, billingCadence: { in: ["MONTHLY", "monthly"] } } }),
    prisma.paymentMethod.count({ where: { member: { locationId: location.id }, status: { in: ["EXPIRED", "FAILING"] }, isDefault: true } }),
  ]);

  const paidNet = (paidMtd._sum.totalCents ?? 0) - (paidMtd._sum.refundedCents ?? 0);
  const overdueCents = (overdueAgg._sum.totalCents ?? 0) - (overdueAgg._sum.refundedCents ?? 0);
  const prev = paidPrev._sum.totalCents ?? 0;
  const deltaVsPrev = prev > 0 ? ((paidNet - prev) / prev) * 100 : undefined;
  const revenueTrend = revenue12mo.slice(-6).map((m) => ({ y: m.revenue }));
  const invoiceStatusSlices = statusMix.map((s) => ({ name: String(s.status), value: s._count._all })).filter((s) => s.value > 0);
  const square = await squareStatusPayload(location.id);

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" description="Income, recurring revenue, and overdue accounts." />
      <SquareConnectCallout status={square} slug={slug} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Paid this month" value={money(paidNet)} delta={deltaVsPrev} trend={revenueTrend} hint={`${paidMtd._count} invoice${paidMtd._count === 1 ? "" : "s"} · net of refunds`} href={`${adminRoutes.loc.billing.payments(slug)}?tab=PAID`} />
        <KpiCard label="Scheduled this month" value={money(scheduledMtd._sum.totalCents ?? 0)} hint={`${scheduledMtd._count} upcoming`} href={`${adminRoutes.loc.billing.payments(slug)}?tab=SCHEDULED`} />
        <KpiCard label="Overdue" value={money(overdueCents)} hint={`${overdueAgg._count} invoice${overdueAgg._count === 1 ? "" : "s"}${cardsExpiring ? ` · ${cardsExpiring} bad card${cardsExpiring === 1 ? "" : "s"}` : ""}`} href={`${adminRoutes.loc.billing.payments(slug)}?tab=OVERDUE`} />
        <KpiCard label="Monthly recurring" value={money(activeSubs._sum.priceCents ?? 0)} hint={`${activeSubs._count} monthly subscription${activeSubs._count === 1 ? "" : "s"}`} href={adminRoutes.loc.billing.recurring(slug)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Revenue" subtitle="Last 12 months · payments net of refunds" />
          <div className="mt-4">
            <AreaChart data={revenue12mo} xKey="month" series={[{ key: "revenue", label: "Revenue" }]} yFormat="currency" height={220} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Invoice status" subtitle="Due since last month" />
          <div className="mt-2">
            {invoiceStatusSlices.length === 0 ? (
              <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">No invoices yet.</p>
            ) : (
              <DonutChart data={invoiceStatusSlices} useStatusColors height={220} />
            )}
          </div>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-apple-lg font-semibold text-apple-text">Overdue invoices</h2>
            <p className="text-apple-sm text-apple-text-secondary">Failed and past-due payments with the latest decline reason. Select rows to retry, mark paid, or write off.</p>
          </div>
          <Link href={`${adminRoutes.loc.billing.payments(slug)}?tab=OVERDUE`} className="text-apple-sm text-apple-blue hover:underline">View all →</Link>
        </div>
        <InvoiceTable
          slug={slug}
          rows={overdueRows.map(toInvoiceTableRow)}
          currency={location.currency}
          squareConfigured={square.configured}
          showDeclineReason
          emptyTitle="Nothing overdue"
          emptyDescription="Failed recurring charges and past-due invoices will show up here with their decline reason."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming invoices" action={<Link href={`${adminRoutes.loc.billing.payments(slug)}?tab=SCHEDULED`} className="text-apple-xs text-apple-blue hover:underline">All →</Link>} />
          {upcoming.length === 0 ? <p className="mt-3 text-apple-sm text-apple-text-tertiary">Nothing due soon.</p> : (
            <ul className="mt-3 divide-y divide-apple-divider">
              {upcoming.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2 text-apple-sm">
                  <div>
                    <Link href={adminRoutes.loc.billing.invoiceDetail(slug, i.id)} className="font-medium text-apple-text hover:underline">{i.member.firstName} {i.member.lastName}</Link>
                    <div className="text-apple-xs text-apple-text-tertiary">Due {i.dueDate.toLocaleDateString()}{i.description ? ` · ${i.description}` : ""}</div>
                  </div>
                  <Money cents={i.totalCents} currency={location.currency} className="font-medium" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent payments" action={<Link href={`${adminRoutes.loc.billing.payments(slug)}?tab=PAID`} className="text-apple-xs text-apple-blue hover:underline">All →</Link>} />
          {recentPayments.length === 0 ? <p className="mt-3 text-apple-sm text-apple-text-tertiary">No recent payments.</p> : (
            <ul className="mt-3 divide-y divide-apple-divider">
              {recentPayments.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2 text-apple-sm">
                  <div>
                    <Link href={adminRoutes.loc.billing.invoiceDetail(slug, i.id)} className="font-medium text-apple-text hover:underline">{i.member.firstName} {i.member.lastName}</Link>
                    <div className="text-apple-xs text-apple-text-tertiary">{i.paidAt?.toLocaleDateString()}{i.description ? ` · ${i.description}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Money cents={i.totalCents} currency={location.currency} className="font-medium" />
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
