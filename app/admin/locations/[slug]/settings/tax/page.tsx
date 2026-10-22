import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { billingSettingsOf } from "@/services/billing.service";
import { getActorContext } from "@/lib/actor";
import { can } from "@/lib/permissions";
import { TaxSettingsSection } from "@/components/admin/billing/BillingSettingsForm";

export const dynamic = "force-dynamic";

export default async function TaxSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const actor = await getActorContext().catch(() => null);
  const canEdit = actor ? can(actor, "billing.configure", { locationId: location.id }) : false;
  const settings = billingSettingsOf(location);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const [mtd, ytd] = await Promise.all([
    prisma.invoice.aggregate({ _sum: { taxCents: true }, where: { locationId: location.id, status: { in: ["PAID", "PARTIALLY_REFUNDED"] }, paidAt: { gte: monthStart } } }),
    prisma.invoice.aggregate({ _sum: { taxCents: true }, where: { locationId: location.id, status: { in: ["PAID", "PARTIALLY_REFUNDED"] }, paidAt: { gte: yearStart } } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax"
        description="Per-location sales tax. The same setting is available under Billing → Settings."
        actions={<Link href={`${adminRoutes.loc.billing.accounting(slug)}?tab=ledger`} className="text-apple-sm text-apple-blue hover:underline">Tax collected (ledger) →</Link>}
      />
      <TaxSettingsSection slug={slug} settings={settings} canEdit={canEdit} />
      <Card>
        <CardHeader title="Tax collected" subtitle="From paid invoices at this location." />
        <div className="mt-3 grid grid-cols-2 gap-4 text-apple-sm">
          <div>
            <div className="text-apple-xs font-medium text-apple-text-tertiary">This month</div>
            <div className="mt-0.5 text-apple-xl font-semibold tabular-nums text-apple-text">${((mtd._sum.taxCents ?? 0) / 100).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-apple-xs font-medium text-apple-text-tertiary">Year to date</div>
            <div className="mt-0.5 text-apple-xl font-semibold tabular-nums text-apple-text">${((ytd._sum.taxCents ?? 0) / 100).toFixed(2)}</div>
          </div>
        </div>
        <p className="mt-3 text-apple-xs text-apple-text-tertiary">Tax is calculated per invoice on the subtotal after discounts. Line-item tax categories are not yet supported.</p>
      </Card>
    </div>
  );
}
