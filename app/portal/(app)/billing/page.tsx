import { Card, CardHeader, EmptyState, StatusBadge, Money } from "@/components/ui";
import { BarChart, KpiCard } from "@/components/ui/charts";
import { getCurrentMember, getMemberSession } from "@/lib/member-session";
import { getPrisma } from "@/lib/db";
import { getSquarePublicConfig } from "@/lib/square";
import { Receipt } from "lucide-react";
import { lastNMonths } from "@/lib/chart-data";
import { PortalCardManager, PortalPayButton } from "./BillingActions";

export const dynamic = "force-dynamic";

const PAYABLE = ["SCHEDULED", "PAST_DUE", "FAILED"];

export default async function PortalBilling() {
  const [member, session] = await Promise.all([getCurrentMember(), getMemberSession()]);
  if (!member) return null;
  const prisma = getPrisma();
  const readOnly = session?.role === "IMPERSONATED";
  const square = await getSquarePublicConfig(member.locationId);

  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  const [invoices, methods, paidYearInvoices, location] = await Promise.all([
    prisma.invoice.findMany({ where: { memberId: member.id, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.paymentMethod.findMany({ where: { memberId: member.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] }),
    prisma.invoice.findMany({
      where: { memberId: member.id, status: "PAID", paidAt: { gte: yearAgo } },
      select: { totalCents: true, paidAt: true },
    }),
    prisma.location.findUnique({ where: { id: member.locationId }, select: { currency: true } }),
  ]);
  const currency = location?.currency ?? "USD";

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
    .reduce((s, i) => s + i.totalCents - i.refundedCents, 0);

  const memberContact = { firstName: member.firstName, lastName: member.lastName, email: member.email, phone: member.phone, zip: member.zip };
  const hasCard = methods.some((m) => m.status !== "EXPIRED");

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
          hint={pastDue > 0 ? (hasCard ? "Pay now or update your card" : "Add a card to pay") : undefined}
        />
      </div>

      <Card>
        <CardHeader title="Billing history" subtitle="Last 12 months" />
        <div className="mt-4">
          <BarChart
            data={billingHistory}
            xKey="month"
            series={[{ key: "paid", label: "Paid" }]}
            yFormat="currency"
            height={200}
            colorByCell
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Payment methods" subtitle="We charge your default card on the billing date of each cycle." />
        <PortalCardManager
          square={square}
          cards={methods.map((m) => ({ id: m.id, brand: m.brand, last4: m.last4, expMonth: m.expMonth, expYear: m.expYear, isDefault: m.isDefault, status: m.status }))}
          member={memberContact}
          readOnly={readOnly}
        />
      </Card>

      <Card>
        <CardHeader title="Invoices" />
        {invoices.length === 0 ? (
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="No invoices yet" />
        ) : (
          <ul className="mt-3 divide-y divide-apple-divider">
            {invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-apple-sm">
                <div>
                  <div className="font-medium text-apple-text">Invoice #{i.number}{i.description ? <span className="font-normal text-apple-text-secondary"> · {i.description}</span> : null}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">
                    {i.paidAt
                      ? `Paid ${new Date(i.paidAt).toLocaleDateString()}`
                      : `Due ${new Date(i.dueDate).toLocaleDateString()}`}
                    {i.lastFailureReason && PAYABLE.includes(i.status) ? ` · ${i.lastFailureReason}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Money cents={i.totalCents} currency={currency} />
                  <StatusBadge status={i.status} size="sm" />
                  {PAYABLE.includes(i.status) && i.totalCents - i.refundedCents > 0 && (
                    <PortalPayButton
                      invoice={{ id: i.id, number: i.number, remainingCents: i.totalCents - i.refundedCents, currency }}
                      square={square}
                      hasCard={hasCard}
                      member={memberContact}
                      readOnly={readOnly}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
