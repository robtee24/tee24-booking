// components/admin/sales/SalesListScreen.tsx
"use client";

import Link from "next/link";
import React from "react";
import { Download, Plus, Receipt, Search } from "lucide-react";
import { Badge, Button, DataTable, Input, PageHeader, Select, StatusBadge, formatMoney, type Column } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { downloadCsv, posFetch, qs, todayISO } from "./api";
import { SaleDetailDrawer } from "./SaleDetailDrawer";
import type { PaymentKind, SaleDTO, SaleStatus, StaffDTO } from "./types";
import { PAYMENT_KIND_LABELS, PAYMENT_KIND_SHORT } from "./types";

export function SalesListScreen({ slug }: { slug: string }) {
  const [sales, setSales] = React.useState<SaleDTO[] | null>(null);
  const [staff, setStaff] = React.useState<StaffDTO[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [from, setFrom] = React.useState(todayISO(-30));
  const [to, setTo] = React.useState(todayISO());
  const [staffId, setStaffId] = React.useState("");
  const [paymentKind, setPaymentKind] = React.useState<PaymentKind | "">("");
  const [status, setStatus] = React.useState<SaleStatus | "">("");
  const [q, setQ] = React.useState("");
  const [selected, setSelected] = React.useState<SaleDTO | null>(null);

  const params = React.useMemo(() => ({ locationSlug: slug, from, to, staffId, paymentKind, status, q }), [slug, from, to, staffId, paymentKind, status, q]);

  const load = React.useCallback(async () => {
    try {
      const r = await posFetch<{ sales: SaleDTO[]; staff: StaffDTO[] }>(`/api/admin/sales${qs(params)}`);
      setSales(r.sales);
      setStaff(r.staff);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sales");
    }
  }, [params]);

  React.useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const totals = React.useMemo(() => {
    const list = sales ?? [];
    return { count: list.length, net: list.reduce((a, s) => a + s.totalCents - s.refundedCents, 0) };
  }, [sales]);

  const columns: Column<SaleDTO>[] = [
    { key: "number", header: "#", width: "70px", cell: (s) => <span className="font-medium tabular-nums">#{s.number}</span> },
    { key: "date", header: "Date", cell: (s) => <span className="whitespace-nowrap text-apple-text-secondary">{new Date(s.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> },
    {
      key: "customer", header: "Customer",
      cell: (s) => (
        <div className="min-w-0">
          <div className="truncate">{s.customerName ?? <span className="text-apple-text-tertiary">Walk-in</span>}</div>
          {s.customerEmail && <div className="truncate text-apple-xs text-apple-text-tertiary">{s.customerEmail}</div>}
        </div>
      ),
    },
    { key: "items", header: "Items", cell: (s) => <span className="line-clamp-1 text-apple-text-secondary">{s.lineItems.map((li) => `${li.quantity > 1 ? `${li.quantity}× ` : ""}${li.description}`).join(", ")}</span> },
    { key: "payment", header: "Payment", cell: (s) => <Badge tone="muted" size="sm"><span className="whitespace-nowrap">{PAYMENT_KIND_SHORT[s.paymentKind]}</span></Badge> },
    { key: "staff", header: "Staff", cell: (s) => <span className="text-apple-text-secondary">{s.staffName ?? "—"}</span> },
    {
      key: "status", header: "Status",
      cell: (s) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge status={s.status} size="sm" />
          {s.status === "PAID" && s.refundedCents > 0 && <Badge tone="warn" size="sm">Partial refund</Badge>}
        </div>
      ),
    },
    { key: "total", header: "Total", align: "right", cell: (s) => <span className={["font-medium tabular-nums", s.status !== "PAID" ? "text-apple-text-tertiary line-through" : ""].join(" ")}>{formatMoney(s.totalCents)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        description="Every point-of-sale transaction at this location."
        meta={sales && <><Badge tone="muted">{totals.count} sales</Badge><Badge tone="success">{formatMoney(totals.net)} net</Badge></>}
        actions={
          <>
            <Button variant="secondary" iconLeft={<Download className="h-4 w-4" />} onClick={() => downloadCsv(`/api/admin/sales${qs({ ...params, format: "csv" })}`)}>Export CSV</Button>
            <Link href={adminRoutes.loc.sales.root(slug)}><Button iconLeft={<Plus className="h-4 w-4" />}>New sale</Button></Link>
          </>
        }
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Input type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select label="Staff" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          <option value="">All staff</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select label="Payment" value={paymentKind} onChange={(e) => setPaymentKind(e.target.value as PaymentKind | "")}>
          <option value="">All methods</option>
          {(Object.keys(PAYMENT_KIND_LABELS) as PaymentKind[]).map((k) => <option key={k} value={k}>{PAYMENT_KIND_LABELS[k]}</option>)}
        </Select>
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as SaleStatus | "")}>
          <option value="">All statuses</option>
          <option value="PAID">Paid</option>
          <option value="REFUNDED">Refunded</option>
          <option value="VOID">Void</option>
        </Select>
        <Input label="Search" prefix={<Search className="h-4 w-4" />} placeholder="Customer, email, item, sale #" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {error && <div className="rounded-apple border border-apple-red/30 bg-apple-red/5 p-4 text-apple-sm text-apple-red">{error}</div>}

      <DataTable
        columns={columns}
        rows={sales ?? []}
        rowKey={(s) => s.id}
        loading={!sales && !error}
        onRowClick={setSelected}
        empty={<span className="inline-flex items-center gap-2"><Receipt className="h-4 w-4" /> No sales in this range.</span>}
      />

      <SaleDetailDrawer slug={slug} sale={selected} onClose={() => setSelected(null)} onChanged={(s) => { setSelected(s); void load(); }} />
    </div>
  );
}
