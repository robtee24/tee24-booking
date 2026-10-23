import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { PageHeader, Button } from "@/components/ui";
import { KpiCard } from "@/components/ui/charts";
import { Plus } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { describeDiscount, listDiscounts } from "@/services/discount.service";
import { DiscountTable, type DiscountRow } from "@/components/admin/billing/DiscountTable";

export const dynamic = "force-dynamic";

export default async function DiscountsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const discounts = await listDiscounts(location.organizationId);
  const ids = discounts.map((d) => d.id);
  const [saved, enrolled] = await Promise.all([
    ids.length ? prisma.discountApplication.groupBy({ by: ["discountId"], where: { discountId: { in: ids }, invoiceId: { not: null } }, _sum: { amountCents: true } }) : [],
    ids.length ? prisma.discountApplication.groupBy({ by: ["discountId"], where: { discountId: { in: ids }, invoiceId: null }, _count: { _all: true } }) : [],
  ]);
  const savedBy = new Map(saved.map((s) => [s.discountId, s._sum.amountCents ?? 0]));
  const enrolledBy = new Map(enrolled.map((s) => [s.discountId, s._count._all]));
  const now = new Date();

  const rows: DiscountRow[] = discounts.map((d) => {
    const expired = d.endsAt && d.endsAt < now;
    const notStarted = d.startsAt && d.startsAt > now;
    const exhausted = d.maxRedemptions != null && d.totalRedemptions >= d.maxRedemptions;
    return {
      id: d.id,
      code: d.code,
      name: d.name,
      description: describeDiscount(d),
      planNames: d.planRestrictions.map((p) => p.plan.name),
      signupFormCount: Array.isArray(d.signupFormIds) ? (d.signupFormIds as string[]).length : 0,
      startsAt: d.startsAt?.toISOString() ?? null,
      endsAt: d.endsAt?.toISOString() ?? null,
      totalRedemptions: d.totalRedemptions,
      maxRedemptions: d.maxRedemptions,
      activeMembers: enrolledBy.get(d.id) ?? 0,
      savedCents: savedBy.get(d.id) ?? 0,
      status: !d.active ? "CANCELLED" : expired ? "EXPIRED" : exhausted ? "FROZEN" : notStarted ? "SCHEDULED" : "ACTIVE",
    };
  });

  const totalSaved = rows.reduce((s, r) => s + r.savedCents, 0);
  const totalRedemptions = rows.reduce((s, r) => s + r.totalRedemptions, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discounts"
        description="Promo codes for signup and recurring billing. Restrict by plan or signup form to control eligibility."
        actions={
          <Link href={adminRoutes.loc.billing.discountNew(slug)}>
            <Button iconLeft={<Plus className="h-4 w-4" />}>New discount</Button>
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiCard label="Active codes" value={rows.filter((r) => r.status === "ACTIVE").length} />
        <KpiCard label="Redemptions" value={totalRedemptions} />
        <KpiCard label="Total discounted" value={`$${(totalSaved / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} hint="across all invoices" />
      </div>
      <DiscountTable slug={slug} rows={rows} currency={location.currency} />
    </div>
  );
}
