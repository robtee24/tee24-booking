"use client";

import Link from "next/link";
import { Card, DataTable, EmptyState, Money, StatusBadge, type Column } from "@/components/ui";
import { RefreshCw } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { SubscriptionRowActions } from "./RecurringActions";

export type RecurringRow = {
  id: string;
  status: string;
  autoRenew: boolean;
  priceCents: number;
  cadenceLabel: string;
  nextInvoiceDate: string | null;
  paidThroughDate: string | null;
  cancelScheduledFor: string | null;
  member: { id: string; firstName: string; lastName: string };
  planName: string;
  adHoc: boolean;
  nextAmountCents: number;
  hasCard: boolean;
};

export function RecurringTable({ slug, rows, currency, squareConfigured, emptyTitle, emptyDescription }: { slug: string; rows: RecurringRow[]; currency: string; squareConfigured: boolean; emptyTitle: string; emptyDescription?: string }) {
  const live = (s: string) => s === "ACTIVE" || s === "CANCEL_SCHEDULED";
  const cols: Column<RecurringRow>[] = [
    {
      key: "member",
      header: "Member",
      cell: (r) => (
        <div className="min-w-0">
          <Link href={adminRoutes.loc.members.detail(slug, r.member.id)} className="font-medium text-apple-text hover:underline">
            {r.member.firstName} {r.member.lastName}
          </Link>
          <div className="truncate text-apple-xs text-apple-text-tertiary">
            {r.planName}
            {r.adHoc && <span className="ml-1 rounded bg-apple-fill-secondary px-1 text-[10px] uppercase">ad-hoc</span>}
          </div>
        </div>
      ),
    },
    { key: "price", header: "Price", align: "right", cell: (r) => <span className="text-apple-sm"><Money cents={r.priceCents} currency={currency} /> <span className="text-apple-text-tertiary">/ {r.cadenceLabel}</span></span> },
    {
      key: "next",
      header: "Next invoice",
      cell: (r) =>
        live(r.status) ? (
          <div className="text-apple-sm">
            <div className="text-apple-text">{r.nextInvoiceDate ? new Date(r.nextInvoiceDate).toLocaleDateString() : <span className="text-apple-text-tertiary">—</span>}</div>
            <div className="text-apple-xs text-apple-text-tertiary"><Money cents={r.nextAmountCents} currency={currency} />{r.nextAmountCents !== r.priceCents ? " incl. tax/discount" : ""}</div>
          </div>
        ) : r.status === "CANCELLED" ? (
          <span className="text-apple-xs text-apple-text-tertiary">—</span>
        ) : (
          <span className="text-apple-xs text-apple-text-tertiary">Paused</span>
        ),
    },
    { key: "paidThrough", header: "Paid through", cell: (r) => <span className="text-apple-sm text-apple-text-secondary">{r.paidThroughDate ? new Date(r.paidThroughDate).toLocaleDateString() : "—"}</span> },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={r.status} size="sm" />
          {r.cancelScheduledFor && <span className="text-[10px] text-apple-text-tertiary">ends {new Date(r.cancelScheduledFor).toLocaleDateString()}</span>}
          {!r.hasCard && squareConfigured && live(r.status) && <span className="text-[10px] text-apple-orange">no card on file</span>}
        </div>
      ),
    },
    { key: "actions", header: "", align: "right", cell: (r) => <SubscriptionRowActions slug={slug} subscriptionId={r.id} autoRenew={r.autoRenew} nextInvoiceDate={r.nextInvoiceDate} status={r.status} /> },
  ];

  return (
    <Card padded={false}>
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} empty={<EmptyState icon={<RefreshCw className="h-6 w-6" />} title={emptyTitle} description={emptyDescription} />} />
    </Card>
  );
}
