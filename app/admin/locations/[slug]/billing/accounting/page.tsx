import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader, Money } from "@/components/ui";
import { Calculator } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AccountingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [paid, refunds, chargebacks, breakdown] = await Promise.all([
    prisma.charge.aggregate({ _sum: { amountCents: true }, where: { locationId: location.id, status: "SUCCEEDED", createdAt: { gte: monthStart } } }),
    prisma.refund.aggregate({ _sum: { amountCents: true }, where: { createdAt: { gte: monthStart }, charge: { locationId: location.id } } }),
    prisma.charge.aggregate({ _sum: { amountCents: true }, where: { locationId: location.id, status: "DISPUTED", updatedAt: { gte: monthStart } } }),
    prisma.invoice.groupBy({
      by: ["description"],
      _sum: { totalCents: true },
      where: { locationId: location.id, status: "PAID", paidAt: { gte: monthStart } },
      orderBy: { _sum: { totalCents: "desc" } },
      take: 10,
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Accounting" description="Revenue, refunds, and reconciliation. Exports for QuickBooks / Xero coming in Phase 2." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Revenue MTD</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums"><Money cents={paid._sum?.amountCents ?? 0} /></div>
        </Card>
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Refunds MTD</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums"><Money cents={refunds._sum?.amountCents ?? 0} /></div>
        </Card>
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Chargebacks MTD</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums"><Money cents={chargebacks._sum?.amountCents ?? 0} /></div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Top revenue lines (MTD)" />
        {breakdown.length === 0 ? (
          <EmptyState icon={<Calculator className="h-6 w-6" />} title="No revenue yet this month" />
        ) : (
          <ul className="mt-4 divide-y divide-apple-divider">
            {breakdown.map((b, i) => (
              <li key={i} className="flex items-center justify-between py-2 text-apple-sm">
                <span className="text-apple-text">{b.description ?? "(uncategorized)"}</span>
                <Money cents={b._sum?.totalCents ?? 0} className="font-medium" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
