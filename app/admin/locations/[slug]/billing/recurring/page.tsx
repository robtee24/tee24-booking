import { Suspense } from "react";
import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { Card, DataTable, EmptyState, PageHeader, Money, StatusBadge, type Column } from "@/components/ui";
import { KpiCard } from "@/components/ui/charts";
import { RefreshCw } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { isSquareConfigured } from "@/lib/square";
import { AD_HOC_PLAN_DESCRIPTION, cadenceLabel, previewNextInvoiceCents } from "@/services/recurring-billing.service";
import { QueryTabs } from "@/components/admin/billing/QueryTabs";
import { SquareConnectCallout } from "@/components/admin/billing/SquareConnectCallout";
import { RecurringHeaderActions, SubscriptionRowActions } from "@/components/admin/billing/RecurringActions";
import { squareStatusPayload } from "@/app/api/admin/billing/_shared";

export const dynamic = "force-dynamic";

const TABS = [
  { value: "ACTIVE", label: "Active" },
  { value: "FROZEN", label: "Frozen" },
  { value: "CANCEL_SCHEDULED", label: "Cancelling" },
  { value: "PENDING", label: "Pending" },
  { value: "CANCELLED", label: "Cancelled" },
];

type Row = {
  id: string;
  status: string;
  autoRenew: boolean;
  priceCents: number;
  billingCadence: string;
  nextInvoiceDate: Date | null;
  paidThroughDate: Date | null;
  startDate: Date;
  cancelScheduledFor: Date | null;
  member: { id: string; firstName: string; lastName: string };
  plan: { id: string; name: string; description: string | null };
  nextAmountCents: number;
  hasCard: boolean;
};

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

  const rows: Row[] = await Promise.all(
    subs.map(async (s) => ({
      id: s.id,
      status: s.status,
      autoRenew: s.autoRenew,
      priceCents: s.priceCents,
      billingCadence: s.billingCadence,
      nextInvoiceDate: s.nextInvoiceDate,
      paidThroughDate: s.paidThroughDate,
      startDate: s.startDate,
      cancelScheduledFor: s.cancelScheduledFor,
      member: { id: s.member.id, firstName: s.member.firstName, lastName: s.member.lastName },
      plan: s.plan,
      hasCard: s.member.paymentMethods.length > 0,
      nextAmountCents: s.status === "ACTIVE" || s.status === "CANCEL_SCHEDULED" ? await previewNextInvoiceCents({ memberId: s.memberId, planId: s.planId, priceCents: s.priceCents, locationTaxRateBps: location.taxRateBps }).catch(() => s.priceCents) : s.priceCents,
    })),
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
  const next30 = rows.filter((r) => r.nextInvoiceDate && r.nextInvoiceDate < in30Days && r.status === "ACTIVE");

  const cols: Column<Row>[] = [
    {
      key: "member",
      header: "Member",
      cell: (r) => (
        <div className="min-w-0">
          <Link href={adminRoutes.loc.members.detail(slug, r.member.id)} className="font-medium text-apple-text hover:underline">
            {r.member.firstName} {r.member.lastName}
          </Link>
          <div className="truncate text-apple-xs text-apple-text-tertiary">
            {r.plan.name}
            {r.plan.description === AD_HOC_PLAN_DESCRIPTION && <span className="ml-1 rounded bg-apple-fill-secondary px-1 text-[10px] uppercase">ad-hoc</span>}
          </div>
        </div>
      ),
    },
    { key: "price", header: "Price", align: "right", cell: (r) => <span className="text-apple-sm"><Money cents={r.priceCents} /> <span className="text-apple-text-tertiary">/ {cadenceLabel(r.billingCadence)}</span></span> },
    {
      key: "next",
      header: "Next invoice",
      cell: (r) =>
        r.status === "ACTIVE" || r.status === "CANCEL_SCHEDULED" ? (
          <div className="text-apple-sm">
            <div className="text-apple-text">{r.nextInvoiceDate ? r.nextInvoiceDate.toLocaleDateString() : <span className="text-apple-text-tertiary">—</span>}</div>
            <div className="text-apple-xs text-apple-text-tertiary"><Money cents={r.nextAmountCents} />{r.nextAmountCents !== r.priceCents ? " incl. tax/discount" : ""}</div>
          </div>
        ) : r.status === "CANCELLED" ? (
          <span className="text-apple-xs text-apple-text-tertiary">—</span>
        ) : (
          <span className="text-apple-xs text-apple-text-tertiary">Paused</span>
        ),
    },
    { key: "paidThrough", header: "Paid through", cell: (r) => <span className="text-apple-sm text-apple-text-secondary">{r.paidThroughDate ? r.paidThroughDate.toLocaleDateString() : "—"}</span> },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={r.status} size="sm" />
          {r.cancelScheduledFor && <span className="text-[10px] text-apple-text-tertiary">ends {r.cancelScheduledFor.toLocaleDateString()}</span>}
          {!r.hasCard && squareConfigured && (r.status === "ACTIVE" || r.status === "CANCEL_SCHEDULED") && <span className="text-[10px] text-apple-orange">no card on file</span>}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) => <SubscriptionRowActions slug={slug} subscriptionId={r.id} autoRenew={r.autoRenew} nextInvoiceDate={r.nextInvoiceDate ? r.nextInvoiceDate.toISOString() : null} status={r.status} />,
    },
  ];

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

      <Card padded={false}>
        <DataTable
          columns={cols}
          rows={rows}
          rowKey={(r) => r.id}
          empty={<EmptyState icon={<RefreshCw className="h-6 w-6" />} title={`No ${TABS.find((t) => t.value === tab)?.label.toLowerCase()} subscriptions`} description={tab === "ACTIVE" ? "Subscriptions are created when a member signs up or an admin assigns a plan. Use “New recurring charge” for ad-hoc recurring fees." : undefined} />}
        />
      </Card>
    </div>
  );
}
