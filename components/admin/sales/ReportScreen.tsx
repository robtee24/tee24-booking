// components/admin/sales/ReportScreen.tsx
"use client";

import Link from "next/link";
import React from "react";
import { AlertTriangle, Download } from "lucide-react";
import { Badge, Button, Card, CardHeader, DataTable, Input, PageHeader, formatMoney, type Column } from "@/components/ui";
import { BarChart, KpiCard } from "@/components/ui/charts";
import { adminRoutes } from "@/lib/admin/routes";
import { downloadCsv, posFetch, qs, todayISO } from "./api";
import type { SalesReportDTO } from "./types";
import { PAYMENT_KIND_LABELS } from "./types";

const PRESETS: Array<{ label: string; days: number }> = [{ label: "7d", days: 6 }, { label: "30d", days: 29 }, { label: "90d", days: 89 }];

export function ReportScreen({ slug }: { slug: string }) {
  const [from, setFrom] = React.useState(todayISO(-29));
  const [to, setTo] = React.useState(todayISO());
  const [report, setReport] = React.useState<SalesReportDTO | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    posFetch<SalesReportDTO>(`/api/admin/sales/report${qs({ locationSlug: slug, from, to })}`)
      .then((r) => { if (!cancelled) { setReport(r); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load report"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, from, to]);

  const k = report?.kpis;
  const chart = (report?.byDay ?? []).map((d) => ({ day: d.day.slice(5), revenue: d.revenueCents / 100 }));

  const productCols: Column<SalesReportDTO["byProduct"][number]>[] = [
    { key: "name", header: "Product", cell: (r) => r.productId ? <Link href={adminRoutes.loc.sales.productDetail(slug, r.productId)} className="text-apple-blue hover:underline">{r.name}</Link> : <span>{r.name}</span> },
    { key: "qty", header: "Qty", align: "right", cell: (r) => <span className="tabular-nums">{r.quantity}</span> },
    { key: "rev", header: "Revenue", align: "right", cell: (r) => <span className="tabular-nums">{formatMoney(r.revenueCents)}</span> },
    { key: "cogs", header: "COGS", align: "right", cell: (r) => <span className="tabular-nums text-apple-text-secondary">{r.cogsCents ? formatMoney(r.cogsCents) : "—"}</span> },
    { key: "gp", header: "Profit", align: "right", cell: (r) => <span className="tabular-nums">{formatMoney(r.revenueCents - r.cogsCents)}</span> },
  ];
  const categoryCols: Column<SalesReportDTO["byCategory"][number]>[] = [
    { key: "name", header: "Category", cell: (r) => r.name },
    { key: "qty", header: "Qty", align: "right", cell: (r) => <span className="tabular-nums">{r.quantity}</span> },
    { key: "rev", header: "Revenue", align: "right", cell: (r) => <span className="tabular-nums">{formatMoney(r.revenueCents)}</span> },
  ];
  const kindCols: Column<SalesReportDTO["byPaymentKind"][number]>[] = [
    { key: "kind", header: "Method", cell: (r) => PAYMENT_KIND_LABELS[r.paymentKind] ?? r.paymentKind },
    { key: "count", header: "Sales", align: "right", cell: (r) => <span className="tabular-nums">{r.count}</span> },
    { key: "rev", header: "Revenue", align: "right", cell: (r) => <span className="tabular-nums">{formatMoney(r.revenueCents)}</span> },
  ];
  const staffCols: Column<SalesReportDTO["byStaff"][number]>[] = [
    { key: "name", header: "Staff", cell: (r) => r.name },
    { key: "count", header: "Sales", align: "right", cell: (r) => <span className="tabular-nums">{r.count}</span> },
    { key: "rev", header: "Revenue", align: "right", cell: (r) => <span className="tabular-nums">{formatMoney(r.revenueCents)}</span> },
    { key: "avg", header: "Avg", align: "right", cell: (r) => <span className="tabular-nums text-apple-text-secondary">{formatMoney(r.count ? Math.round(r.revenueCents / r.count) : 0)}</span> },
  ];
  const lowCols: Column<SalesReportDTO["lowInventory"][number]>[] = [
    { key: "name", header: "Product", cell: (r) => <Link href={adminRoutes.loc.sales.productDetail(slug, r.id)} className="text-apple-blue hover:underline">{r.name}</Link> },
    { key: "sku", header: "SKU", cell: (r) => <span className="text-apple-text-secondary">{r.sku ?? "—"}</span> },
    { key: "inv", header: "On hand", align: "right", cell: (r) => <span className="font-medium tabular-nums text-apple-orange">{r.inventory}</span> },
    { key: "at", header: "Alert at", align: "right", cell: (r) => <span className="tabular-nums text-apple-text-secondary">{r.lowStockAt ?? "—"}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Report"
        description="Revenue excludes tax; refunds and voids are netted out."
        actions={<Button variant="secondary" iconLeft={<Download className="h-4 w-4" />} onClick={() => downloadCsv(`/api/admin/sales/report${qs({ locationSlug: slug, from, to, format: "csv" })}`)}>Export CSV</Button>}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Input type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="flex gap-2">
          {PRESETS.map((p) => <Button key={p.label} size="md" variant="secondary" onClick={() => { setFrom(todayISO(-p.days)); setTo(todayISO()); }}>{p.label}</Button>)}
        </div>
      </div>

      {error && <div className="rounded-apple border border-apple-red/30 bg-apple-red/5 p-4 text-apple-sm text-apple-red">{error}</div>}

      <div className={["grid gap-3 sm:grid-cols-2 lg:grid-cols-4", loading ? "opacity-60" : ""].join(" ")}>
        <KpiCard label="Revenue" value={formatMoney(k?.revenueCents ?? 0)} hint={`${k?.saleCount ?? 0} sales`} />
        <KpiCard label="Gross profit" value={formatMoney(k?.grossProfitCents ?? 0)} hint={`COGS ${formatMoney(k?.cogsCents ?? 0)}`} />
        <KpiCard label="Avg sale" value={formatMoney(k?.avgSaleCents ?? 0)} />
        <KpiCard label="Tax collected" value={formatMoney(k?.taxCents ?? 0)} />
        <KpiCard label="Discounts" value={formatMoney(k?.discountCents ?? 0)} />
        <KpiCard label="Refunds" value={formatMoney(k?.refundedCents ?? 0)} />
        <KpiCard label="COGS" value={formatMoney(k?.cogsCents ?? 0)} />
        <KpiCard label="Low-stock items" value={report?.lowInventory.length ?? 0} />
      </div>

      <Card>
        <CardHeader title="Revenue by day" subtitle="Net of discounts and refunds, before tax" />
        <div className="mt-4">
          {chart.length ? <BarChart data={chart} xKey="day" series={[{ key: "revenue", label: "Revenue" }]} yFormat="currency" height={260} /> : <p className="py-10 text-center text-apple-sm text-apple-text-tertiary">No data.</p>}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-5 pb-3"><CardHeader title="By product" /></div>
          <DataTable columns={productCols} rows={report?.byProduct ?? []} rowKey={(r) => r.productId ?? r.name} density="compact" loading={loading && !report} empty="No sales." />
        </Card>
        <Card padded={false}>
          <div className="p-5 pb-3"><CardHeader title="By category" /></div>
          <DataTable columns={categoryCols} rows={report?.byCategory ?? []} rowKey={(r) => r.name} density="compact" loading={loading && !report} empty="No sales." />
        </Card>
        <Card padded={false}>
          <div className="p-5 pb-3"><CardHeader title="By payment method" /></div>
          <DataTable columns={kindCols} rows={report?.byPaymentKind ?? []} rowKey={(r) => r.paymentKind} density="compact" loading={loading && !report} empty="No sales." />
        </Card>
        <Card padded={false}>
          <div className="p-5 pb-3"><CardHeader title="By staff" /></div>
          <DataTable columns={staffCols} rows={report?.byStaff ?? []} rowKey={(r) => r.staffId ?? "unknown"} density="compact" loading={loading && !report} empty="No sales." />
        </Card>
      </div>

      <Card padded={false}>
        <div className="flex items-center justify-between p-5 pb-3">
          <CardHeader title="Low inventory" subtitle="Tracked products at or below their alert threshold" />
          {report && report.lowInventory.length > 0 && <Badge tone="warn"><AlertTriangle className="h-3 w-3" /> {report.lowInventory.length}</Badge>}
        </div>
        <DataTable columns={lowCols} rows={report?.lowInventory ?? []} rowKey={(r) => r.id} density="compact" loading={loading && !report} empty="All tracked products are above their thresholds." />
      </Card>
    </div>
  );
}
