"use client";

import Link from "next/link";
import { Card, DataTable, EmptyState, Money, StatusBadge, type Column } from "@/components/ui";
import { BookOpen, Calculator } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";

/* ── Ledger ───────────────────────────────────────────────────────────── */

export type LedgerTableRow = {
  id: string;
  date: string;
  type: string;
  memberId: string | null;
  memberName: string;
  description: string;
  method: string;
  netCents: number; // signed
  taxCents: number; // signed
  totalCents: number; // signed
  glCode: string | null;
  incomeCategory: string | null;
  reference: string | null;
  invoiceId: string | null;
  invoiceNumber: number | null;
};

export function LedgerTable({ slug, rows, currency }: { slug: string; rows: LedgerTableRow[]; currency: string }) {
  const cols: Column<LedgerTableRow>[] = [
    { key: "date", header: "Date", cell: (r) => <span className="whitespace-nowrap text-apple-sm text-apple-text-secondary">{new Date(r.date).toLocaleDateString()}</span> },
    { key: "type", header: "Type", cell: (r) => <StatusBadge status={r.totalCents < 0 ? "REFUNDED" : "PAID"} size="sm" /> },
    {
      key: "who",
      header: "Member / description",
      cell: (r) => (
        <div className="min-w-0">
          {r.memberId ? <Link href={adminRoutes.loc.members.detail(slug, r.memberId)} className="font-medium text-apple-text hover:underline">{r.memberName}</Link> : <span className="font-medium text-apple-text">{r.memberName}</span>}
          <div className="truncate text-apple-xs text-apple-text-tertiary">
            {r.type} · {r.description}
            {r.invoiceId && r.invoiceNumber != null && <> · <Link href={adminRoutes.loc.billing.invoiceDetail(slug, r.invoiceId)} className="hover:underline">#{r.invoiceNumber}</Link></>}
          </div>
        </div>
      ),
    },
    { key: "method", header: "Method", cell: (r) => <span className="text-apple-xs text-apple-text-secondary">{r.method}</span> },
    { key: "gl", header: "GL / category", cell: (r) => <span className="text-apple-xs text-apple-text-secondary">{[r.glCode, r.incomeCategory].filter(Boolean).join(" · ") || "—"}</span> },
    { key: "net", header: "Net", align: "right", cell: (r) => <Money cents={r.netCents} currency={currency} /> },
    { key: "tax", header: "Tax", align: "right", cell: (r) => <span className="text-apple-text-secondary"><Money cents={r.taxCents} currency={currency} /></span> },
    { key: "total", header: "Total", align: "right", cell: (r) => <Money cents={r.totalCents} currency={currency} className={`font-medium ${r.totalCents < 0 ? "text-apple-red" : ""}`} /> },
    { key: "ref", header: "Reference", cell: (r) => <span className="font-mono text-[10px] text-apple-text-tertiary">{r.reference ?? ""}</span> },
  ];
  return (
    <Card padded={false}>
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} density="compact" empty={<EmptyState icon={<BookOpen className="h-6 w-6" />} title="No transactions in this range" description="Payments, refunds, and point-of-sale sales appear here once money moves." />} />
    </Card>
  );
}

/* ── Revenue by plan ─────────────────────────────────────────────────── */

export type PlanRevenueRow = { name: string; glCode: string | null; incomeCategory: string | null; count: number; grossCents: number; netCents: number; taxCents: number };

export function PlanRevenueTable({ rows, currency }: { rows: PlanRevenueRow[]; currency: string }) {
  const total = rows.reduce((s, r) => s + r.netCents, 0);
  const cols: Column<PlanRevenueRow>[] = [
    { key: "plan", header: "Plan / line", cell: (r) => <span className="font-medium text-apple-text">{r.name}</span> },
    { key: "gl", header: "GL / category", cell: (r) => <span className="text-apple-xs text-apple-text-secondary">{[r.glCode, r.incomeCategory].filter(Boolean).join(" · ") || "—"}</span> },
    { key: "count", header: "Invoices", align: "right", cell: (r) => <span className="tabular-nums">{r.count}</span> },
    { key: "gross", header: "Gross", align: "right", cell: (r) => <Money cents={r.grossCents} currency={currency} /> },
    { key: "tax", header: "Tax", align: "right", cell: (r) => <span className="text-apple-text-secondary"><Money cents={r.taxCents} currency={currency} /></span> },
    { key: "net", header: "Net", align: "right", cell: (r) => <Money cents={r.netCents} currency={currency} className="font-medium" /> },
    { key: "share", header: "Share", align: "right", cell: (r) => <span className="tabular-nums text-apple-text-secondary">{total > 0 ? `${((r.netCents / total) * 100).toFixed(1)}%` : "—"}</span> },
  ];
  return (
    <Card padded={false}>
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.name} empty={<EmptyState icon={<Calculator className="h-6 w-6" />} title="No paid invoices in this range" />} />
    </Card>
  );
}

/* ── Member balances ─────────────────────────────────────────────────── */

export type BalanceRow = { memberId: string; name: string; status: string; openInvoices: number; outstandingCents: number; creditCents: number; netCents: number };

export function BalancesTable({ slug, rows, currency }: { slug: string; rows: BalanceRow[]; currency: string }) {
  const cols: Column<BalanceRow>[] = [
    {
      key: "member",
      header: "Member",
      cell: (r) => (
        <div className="flex items-center gap-2">
          <Link href={adminRoutes.loc.members.detail(slug, r.memberId)} className="font-medium text-apple-text hover:underline">{r.name}</Link>
          <StatusBadge status={r.status} size="sm" />
        </div>
      ),
    },
    { key: "open", header: "Open invoices", align: "right", cell: (r) => <span className="tabular-nums">{r.openInvoices}</span> },
    { key: "owed", header: "Outstanding", align: "right", cell: (r) => <Money cents={r.outstandingCents} currency={currency} className={r.outstandingCents > 0 ? "font-medium text-apple-red" : ""} /> },
    { key: "credit", header: "Credit", align: "right", cell: (r) => <Money cents={r.creditCents} currency={currency} className={r.creditCents > 0 ? "font-medium text-apple-green" : ""} /> },
    { key: "net", header: "Net balance", align: "right", cell: (r) => <Money cents={r.netCents} currency={currency} className="font-medium" /> },
    { key: "link", header: "", align: "right", cell: (r) => <Link href={`${adminRoutes.loc.billing.payments(slug)}?memberId=${r.memberId}`} className="text-apple-xs text-apple-blue hover:underline">Invoices →</Link> },
  ];
  return (
    <Card padded={false}>
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.memberId} empty={<EmptyState icon={<Calculator className="h-6 w-6" />} title="Everyone is settled up" description="Members with open invoices or account credit appear here." />} />
    </Card>
  );
}
