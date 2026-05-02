import { Card, CardHeader, EmptyState, StatusBadge, Money } from "@/components/ui";
import { BarChart, KpiCard } from "@/components/ui/charts";
import { getCurrentMember } from "@/lib/member-session";
import { getPrisma } from "@/lib/db";
import { Receipt } from "lucide-react";
import { lastNMonths } from "@/lib/chart-data";

export const dynamic = "force-dynamic";

export default async function PortalBilling() {
  const member = await getCurrentMember();
  if (!member) return null;
  const prisma = getPrisma();

  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  const [invoices, methods, paidYearInvoices] = await Promise.all([
    prisma.invoice.findMany({ where: { memberId: member.id }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.paymentMethod.findMany({ where: { memberId: member.id }, orderBy: { isDefault: "desc" } }),
    prisma.invoice.findMany({
      where: { memberId: member.id, status: "PAID", paidAt: { gte: yearAgo } },
      select: { totalCents: true, paidAt: true },
    }),
  ]);

  const months = lastNMonths(12);
  const billingHistory = months.map((m) => {
    const total = paidYearInvoices
      .filter((i) => i.paidAt && i.paidAt >= m.start && i.paidAt < m.end)
      .reduce((s, i) => s + i.totalCents, 0);
    return { month: m.label, paid: Math.round(total / 100) };
  });

  const totalPaidYear = paidYearInvoices.reduce((s, i) => s + i.totalCents, 0);
  const upcomingDue = invoices
    .filter((i) => i.status === "SCHEDULED")
    .reduce((s, i) => s + i.totalCents, 0);
  const pastDue = invoices
    .filter((i) => i.status === "PAST_DUE" || i.status === "FAILED")
    .reduce((s, i) => s + i.totalCents, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-apple-2xl font-semibold tracking-tight">Billing</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Paid this year"
          value={`$${(totalPaidYear / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
        />
        <KpiCard
          label="Upcoming"
          value={`$${(upcomingDue / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
        />
        <KpiCard
          label="Past due"
          value={`$${(pastDue / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
          hint={pastDue > 0 ? "Please update payment method" : undefined}
        />
      </div>

      <Card>
        <CardHeader title="Billing history" subtitle="Last 12 months" />
        <div className="mt-4">
          <BarChart
            data={billingHistory}
            xKey="month"
            series={[{ key: "paid", label: "Paid" }]}
            yFormatter={(v) => `$${v.toLocaleString()}`}
            height={200}
            colorByCell
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Payment methods" subtitle="We charge your default card on the billing date of each cycle." />
        <div className="mt-4 space-y-2">
          {methods.length === 0 ? (
            <p className="text-apple-sm text-apple-text-tertiary">No card on file.</p>
          ) : (
            methods.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-apple-sm border border-apple-divider px-3 py-2 text-apple-sm">
                <div className="font-medium text-apple-text">{m.brand} •••• {m.last4}</div>
                <div className="text-apple-xs text-apple-text-tertiary">
                  {m.isDefault && "Default · "}Exp {m.expMonth?.toString().padStart(2, "0")}/{m.expYear}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Invoices" />
        {invoices.length === 0 ? (
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="No invoices yet" />
        ) : (
          <ul className="mt-3 divide-y divide-apple-divider">
            {invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2 text-apple-sm">
                <div>
                  <div className="font-medium text-apple-text">Invoice #{i.number}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">
                    {i.paidAt
                      ? `Paid ${new Date(i.paidAt).toLocaleDateString()}`
                      : `Due ${new Date(i.dueDate).toLocaleDateString()}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Money cents={i.totalCents} />
                  <StatusBadge status={i.status} size="sm" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
