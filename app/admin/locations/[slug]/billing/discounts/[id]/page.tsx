import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { Card, CardHeader, Money, PageHeader, StatusBadge } from "@/components/ui";
import { KpiCard } from "@/components/ui/charts";
import { ArrowLeft } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { describeDiscount, getDiscountUsage } from "@/services/discount.service";
import { DiscountForm, type DiscountFormValues } from "@/components/admin/billing/DiscountForm";

export const dynamic = "force-dynamic";

export default async function DiscountDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const discount = await prisma.discount.findUnique({ where: { id }, include: { planRestrictions: { select: { planId: true } } } });
  if (!discount || (discount.organizationId && discount.organizationId !== location.organizationId)) notFound();

  const [plans, forms, usage, enrolled] = await Promise.all([
    prisma.membershipPlan.findMany({ where: { archived: false, OR: [{ organizationId: location.organizationId }, { organizationId: null }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.signupForm.findMany({ where: { OR: [{ locationId: location.id }, { organizationId: location.organizationId }] }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
    getDiscountUsage(discount.id),
    prisma.discountApplication.count({ where: { discountId: discount.id, invoiceId: null } }),
  ]);

  const initial: DiscountFormValues = {
    code: discount.code,
    name: discount.name,
    type: discount.type === "FIXED" ? "FIXED" : "PERCENT",
    value: discount.type === "FIXED" ? (discount.value / 100).toFixed(2) : String(discount.value),
    scope: discount.scope === "RECURRING" && !discount.recurringMonths ? "FOREVER" : discount.scope === "LIMITED_RECURRING" ? "RECURRING" : (discount.scope as DiscountFormValues["scope"]),
    recurringMonths: String(discount.recurringMonths ?? 3),
    maxRedemptions: discount.maxRedemptions != null ? String(discount.maxRedemptions) : "",
    perMemberLimit: discount.perMemberLimit != null ? String(discount.perMemberLimit) : "",
    startsAt: discount.startsAt ? discount.startsAt.toISOString().slice(0, 10) : "",
    endsAt: discount.endsAt ? discount.endsAt.toISOString().slice(0, 10) : "",
    active: discount.active,
    planIds: discount.planRestrictions.map((p) => p.planId),
    signupFormIds: Array.isArray(discount.signupFormIds) ? (discount.signupFormIds as string[]) : [],
  };

  return (
    <div className="space-y-6">
      <Link href={adminRoutes.loc.billing.discounts(slug)} className="inline-flex items-center gap-1 text-apple-sm text-apple-text-secondary hover:text-apple-text">
        <ArrowLeft className="h-4 w-4" /> Discounts
      </Link>
      <PageHeader
        title={discount.code}
        description={`${discount.name} · ${describeDiscount(discount)}`}
        meta={<StatusBadge status={discount.active ? "ACTIVE" : "CANCELLED"} />}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Redemptions" value={`${discount.totalRedemptions}${discount.maxRedemptions ? ` / ${discount.maxRedemptions}` : ""}`} />
        <KpiCard label="Members enrolled" value={enrolled} hint="recurring discount active" />
        <KpiCard label="Invoices discounted" value={usage.invoiceCount} />
        <KpiCard label="Total saved" value={`$${(usage.totalSavedCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DiscountForm slug={slug} discountId={discount.id} initial={initial} plans={plans} signupForms={forms} />
        </div>
        <Card>
          <CardHeader title="Recent usage" subtitle="Invoices this code was applied to" />
          {usage.rows.length === 0 ? (
            <p className="mt-3 text-apple-sm text-apple-text-tertiary">Not used yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-apple-divider">
              {usage.rows.slice(0, 25).map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2 text-apple-sm">
                  <div className="min-w-0">
                    {r.member ? (
                      <Link href={adminRoutes.loc.members.detail(slug, r.member.id)} className="font-medium text-apple-text hover:underline">{r.member.firstName} {r.member.lastName}</Link>
                    ) : (
                      <span className="text-apple-text-tertiary">Unknown member</span>
                    )}
                    <div className="text-apple-xs text-apple-text-tertiary">
                      {r.appliedAt.toLocaleDateString()}
                      {r.invoice && <> · <Link href={adminRoutes.loc.billing.invoiceDetail(slug, r.invoice.id)} className="hover:underline">Invoice #{r.invoice.number}</Link></>}
                    </div>
                  </div>
                  <span className="text-apple-green">−<Money cents={r.amountCents} currency={location.currency} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
