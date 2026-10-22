import { Suspense } from "react";
import { getPrisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { isSquareConfigured } from "@/lib/square";
import { countInvoicesByTab, queryInvoices, type InvoiceTab } from "@/services/billing.service";
import { InvoiceTable, toInvoiceTableRow } from "@/components/admin/billing/InvoiceTable";
import { InvoiceFilters } from "@/components/admin/billing/InvoiceFilters";
import { QueryTabs } from "@/components/admin/billing/QueryTabs";
import { SquareConnectCallout } from "@/components/admin/billing/SquareConnectCallout";
import { squareStatusPayload } from "@/app/api/admin/billing/_shared";
import { NewInvoiceButton } from "@/components/admin/billing/NewInvoiceButton";

export const dynamic = "force-dynamic";

const TABS: InvoiceTab[] = ["PAID", "SCHEDULED", "OVERDUE", "REFUNDED", "CANCELLED", "ALL"];
const TAB_LABEL: Record<InvoiceTab, string> = { PAID: "Paid", SCHEDULED: "Scheduled", OVERDUE: "Overdue", REFUNDED: "Refunded", CANCELLED: "Cancelled", ALL: "All" };

function dateParam(v: string | undefined) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function PaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const tabRaw = (sp.tab ?? "ALL").toUpperCase() as InvoiceTab;
  const tab = TABS.includes(tabRaw) ? tabRaw : "ALL";
  const base = {
    q: sp.q ?? null,
    number: sp.number ?? null,
    txn: sp.txn ?? null,
    last4: sp.last4 ?? null,
    memberId: sp.memberId ?? null,
    memberStatus: sp.memberStatus ?? null,
    scheduledFrom: dateParam(sp.scheduledFrom),
    scheduledTo: dateParam(sp.scheduledTo),
    paidFrom: dateParam(sp.paidFrom),
    paidTo: dateParam(sp.paidTo),
  };

  const [rows, counts, member, members] = await Promise.all([
    queryInvoices({ locationId: location.id, tab, ...base, take: 300 }),
    countInvoicesByTab(location.id, base),
    sp.memberId ? prisma.member.findUnique({ where: { id: sp.memberId }, select: { firstName: true, lastName: true } }) : null,
    prisma.member.findMany({ where: { locationId: location.id, status: { in: ["ACTIVE", "PENDING", "FROZEN"] } }, select: { id: true, firstName: true, lastName: true, email: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 2000 }),
  ]);

  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const square = squareStatusPayload();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Every invoice: paid, scheduled, overdue, refunded. Select rows for bulk actions."
        actions={<NewInvoiceButton slug={slug} members={members} taxRateBps={location.taxRateBps} currency={location.currency} />}
      />
      <SquareConnectCallout status={square} />

      <Suspense>
        <QueryTabs
          defaultValue="ALL"
          items={TABS.map((t) => ({ value: t, label: TAB_LABEL[t], badge: t === "ALL" ? total : counts[t] }))}
        />
        <InvoiceFilters slug={slug} memberName={member ? `${member.firstName} ${member.lastName}` : null} />
      </Suspense>

      <InvoiceTable
        slug={slug}
        rows={rows.map(toInvoiceTableRow)}
        currency={location.currency}
        squareConfigured={isSquareConfigured()}
        showDeclineReason={tab === "OVERDUE" || tab === "ALL"}
        emptyTitle={tab === "ALL" ? "No invoices yet" : `No ${TAB_LABEL[tab].toLowerCase()} invoices`}
        emptyDescription={tab === "ALL" ? "Invoices are generated automatically from recurring subscriptions, signups, and day passes." : undefined}
      />
    </div>
  );
}
