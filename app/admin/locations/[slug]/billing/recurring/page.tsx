import { Suspense } from "react";
import { getPrisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { KpiCard } from "@/components/ui/charts";
import { isSquareConfigured } from "@/lib/square";
import { AD_HOC_PLAN_DESCRIPTION, cadenceLabel, previewNextInvoiceCents } from "@/services/recurring-billing.service";
import { QueryTabs } from "@/components/admin/billing/QueryTabs";
import { SquareConnectCallout } from "@/components/admin/billing/SquareConnectCallout";
import { RecurringHeaderActions } from "@/components/admin/billing/RecurringActions";
import { RecurringTable, type RecurringRow } from "@/components/admin/billing/RecurringTable";
import { squareStatusPayload } from "@/app/api/admin/billing/_shared";

export const dynamic = "force-dynamic";

const TABS = [
  { value: "ACTIVE", label: "Active" },
  { value: "FROZEN", label: "Frozen" },
  { value: "CANCEL_SCHEDULED", label: "Cancelling" },
  { value: "PENDING", label: "Pending" },
  { value: "CANCELLED", label: "Cancelled" },
];

export default async function RecurringPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const tab = TABS.some((t) => t.value === sp.tab) ? (sp.tab as string) : "ACTIVE";

  const [subs, counts, members, mrr] = await Promise.all([
    prisma.membershipSubscription.findMany({
      where: { locationId: location.id, status: tab },
      orderBy: tab === "ACTIVE" ? [{ nextInvoiceDate: "asc" }, { startDate: "desc" }] : [{ updatedAt: "desc" }],
      take: 300,
      include: {
        member: { select: { id: true, firstName: true, lastName: true, paymentMethods: { where: { isDefault: true, status: { not: "EXPIRED" } }, select: { id: true }, take: 1 } } },
        plan: { select: { id: true, name: true, description: true } },
      },
    }),
    prisma.membershipSubscription.groupBy({ by: ["status"], where: { locationId: location.id }, _count: { _all: true } }),
    prisma.member.findMany({ where: { locationId: location.id, status: { in: ["ACTIVE", "PENDING", "FROZEN"] } }, select: { id: true, firstName: true, lastName: true, email: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 2000 }),
    prisma.membershipSubscription.findMany({ where: { locationId: location.id, status: { in: ["ACTIVE", "CANCEL_SCHEDULED"] } }, select: { priceCents: true, billingCadence: true } }),
  ]);
  const countBy = Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number>;

  const rows: RecurringRow[] = await Promise.all(
    subs.map(async (s) => {
      const live = s.status === "ACTIVE" || s.status === "CANCEL_SCHEDULED";
      return {
        id: s.id,
        status: s.status,
        autoRenew: s.autoRenew,
        priceCents: s.priceCents,
        cadenceLabel: cadenceLabel(s.billingCadence),
        nextInvoiceDate: s.nextInvoiceDate?.toISOString() ?? null,
        paidThroughDate: s.paidThroughDate?.toISOString() ?? null,
        cancelScheduledFor: s.cancelScheduledFor?.toISOString() ?? null,
        member: { id: s.member.id, firstName: s.member.firstName, lastName: s.member.lastName },
        planName: s.plan.name,
        adHoc: s.plan.description === AD_HOC_PLAN_DESCRIPTION,
        hasCard: s.member.paymentMethods.length > 0,
        nextAmountCents: live ? await previewNextInvoiceCents({ memberId: s.memberId, planId: s.planId, priceCents: s.priceCents, locationTaxRateBps: location.taxRateBps }).catch(() => s.priceCents) : s.priceCents,
      };
    }),
  );

  // Normalised monthly recurring revenue
  const monthlyFactor = (c: string) => {
    const u = c.toUpperCase();
    return u === "WEEKLY" ? 52 / 12 : u === "QUARTERLY" ? 1 / 3 : u === "YEARLY" || u === "ANNUAL" ? 1 / 12 : u === "ONE_OFF" ? 0 : 1;
  };
  const mrrCents = Math.round(mrr.reduce((s, x) => s + x.priceCents * monthlyFactor(x.billingCadence), 0));
  const squareConfigured = isSquareConfigured();
  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);
  const next30 = rows.filter((r) => r.nextInvoiceDate && new Date(r.nextInvoiceDate) < in30Days && r.status === "ACTIVE");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recurring"
        description="Subscriptions and recurring charges. Invoices are generated daily at 09:00 UTC and charged to the default card on file."
        actions={<RecurringHeaderActions slug={slug} members={members} squareConfigured={squareConfigured} currency={location.currency} />}
      />
      <SquareConnectCallout status={squareStatusPayload()} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiCard label="Monthly recurring revenue" value={`$${(mrrCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} hint="normalised to monthly" />
        <KpiCard label="Active subscriptions" value={(countBy.ACTIVE ?? 0) + (countBy.CANCEL_SCHEDULED ?? 0)} hint={countBy.CANCEL_SCHEDULED ? `${countBy.CANCEL_SCHEDULED} cancelling` : undefined} />
        <KpiCard label="Due in next 30 days" value={next30.length} hint={`$${(next30.reduce((s, r) => s + r.nextAmountCents, 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
      </div>

      <Suspense>
        <QueryTabs defaultValue="ACTIVE" items={TABS.map((t) => ({ ...t, badge: countBy[t.value] ?? 0 }))} />
      </Suspense>

      <RecurringTable
        slug={slug}
        rows={rows}
        currency={location.currency}
        squareConfigured={squareConfigured}
        emptyTitle={`No ${TABS.find((t) => t.value === tab)?.label.toLowerCase()} subscriptions`}
        emptyDescription={tab === "ACTIVE" ? "Subscriptions are created when a member signs up or an admin assigns a plan. Use “New recurring charge” for ad-hoc recurring fees." : undefined}
      />
    </div>
  );
}
