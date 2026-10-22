"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, DataTable, EmptyState, Modal, Money, Select, StatusBadge, Textarea, useToast, type Column } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { Receipt, RefreshCw, Banknote, Ban } from "lucide-react";

export type InvoiceTableRow = {
  id: string;
  number: number;
  status: string;
  description: string | null;
  totalCents: number;
  refundedCents: number;
  dueDate: string;
  paidAt: string | null;
  attemptCount: number;
  nextRetryAt: string | null;
  lastFailureReason: string | null;
  member: { id: string; firstName: string; lastName: string; email: string; status: string };
  planName: string | null;
  card: string | null; // "VISA •••• 4242"
  squarePaymentId: string | null;
};

const OVERDUE = ["PAST_DUE", "FAILED"];
const OPEN = ["SCHEDULED", "PAST_DUE", "FAILED"];

/**
 * Invoice list with multi-select and bulk actions. Row click → invoice detail.
 */
export function InvoiceTable({
  slug,
  rows,
  currency = "USD",
  squareConfigured,
  showDeclineReason = false,
  emptyTitle = "No invoices",
  emptyDescription,
}: {
  slug: string;
  rows: InvoiceTableRow[];
  currency?: string;
  squareConfigured: boolean;
  showDeclineReason?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<string | null>(null);
  const [modal, setModal] = React.useState<"mark-paid" | "write-off" | null>(null);
  const [method, setMethod] = React.useState("CASH");
  const [note, setNote] = React.useState("");

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const openSelected = selectedRows.filter((r) => OPEN.includes(r.status));
  const overdueSelected = selectedRows.filter((r) => OVERDUE.includes(r.status));

  async function bulk(action: "retry" | "mark-paid" | "write-off", ids: string[], extra: Record<string, unknown> = {}) {
    if (ids.length === 0) return;
    setBusy(action);
    try {
      const res = await fetch("/api/admin/invoices/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationSlug: slug, action, ids, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Request failed");
      const ok = typeof json.succeeded === "number" ? json.succeeded : ids.length;
      const failed = json.failed ?? 0;
      toast({ tone: failed ? "info" : "success", title: `${action === "retry" ? "Retried" : action === "mark-paid" ? "Marked paid" : "Written off"}: ${ok}`, description: failed ? `${failed} failed` : undefined });
      setSelected(new Set());
      setModal(null);
      setNote("");
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Bulk action failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  const cols: Column<InvoiceTableRow>[] = [
    { key: "n", header: "#", width: "72px", cell: (r) => <span className="font-mono text-apple-xs text-apple-text-secondary">{r.number}</span> },
    {
      key: "member",
      header: "Member",
      cell: (r) => (
        <div className="min-w-0">
          <Link href={adminRoutes.loc.members.detail(slug, r.member.id)} onClick={(e) => e.stopPropagation()} className="font-medium text-apple-text hover:underline">
            {r.member.firstName} {r.member.lastName}
          </Link>
          <div className="truncate text-apple-xs text-apple-text-tertiary">{r.planName ?? r.description ?? ""}</div>
        </div>
      ),
    },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} size="sm" /> },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (r) => (
        <div>
          <Money cents={r.totalCents} currency={currency} className="font-medium" />
          {r.refundedCents > 0 && <div className="text-apple-xs text-apple-text-tertiary">−<Money cents={r.refundedCents} currency={currency} /> refunded</div>}
        </div>
      ),
    },
    {
      key: "due",
      header: "Due / Paid",
      cell: (r) => (
        <span className="text-apple-sm text-apple-text-secondary">
          {r.paidAt ? `Paid ${new Date(r.paidAt).toLocaleDateString()}` : `Due ${new Date(r.dueDate).toLocaleDateString()}`}
        </span>
      ),
    },
    { key: "card", header: "Card", cell: (r) => <span className="text-apple-xs text-apple-text-secondary">{r.card ?? "—"}</span> },
  ];
  if (showDeclineReason) {
    cols.push({
      key: "reason",
      header: "Decline reason",
      cell: (r) => (
        <div className="max-w-[260px]">
          <div className="truncate text-apple-xs text-apple-red" title={r.lastFailureReason ?? ""}>{r.lastFailureReason ?? "—"}</div>
          <div className="text-[10px] text-apple-text-tertiary">
            {r.attemptCount} attempt{r.attemptCount === 1 ? "" : "s"}
            {r.nextRetryAt ? ` · retry ${new Date(r.nextRetryAt).toLocaleDateString()}` : ""}
          </div>
        </div>
      ),
    });
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-apple border border-apple-blue/30 bg-apple-blue/5 px-3 py-2 text-apple-sm">
          <span className="font-medium text-apple-text">{selected.size} selected</span>
          <span className="text-apple-text-tertiary">·</span>
          <Button size="sm" variant="secondary" iconLeft={<RefreshCw className="h-3.5 w-3.5" />} disabled={!squareConfigured || overdueSelected.length === 0} loading={busy === "retry"} onClick={() => bulk("retry", overdueSelected.map((r) => r.id))} title={squareConfigured ? undefined : "Connect Square to retry cards"}>
            Retry charge ({overdueSelected.length})
          </Button>
          <Button size="sm" variant="secondary" iconLeft={<Banknote className="h-3.5 w-3.5" />} disabled={openSelected.length === 0} onClick={() => setModal("mark-paid")}>
            Mark paid ({openSelected.length})
          </Button>
          <Button size="sm" variant="danger" iconLeft={<Ban className="h-3.5 w-3.5" />} disabled={openSelected.length === 0} onClick={() => setModal("write-off")}>
            Write off ({openSelected.length})
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
      <Card padded={false}>
        <DataTable
          columns={cols}
          rows={rows}
          rowKey={(r) => r.id}
          selectable
          selectedKeys={selected}
          onSelectionChange={setSelected}
          onRowClick={(r) => router.push(adminRoutes.loc.billing.invoiceDetail(slug, r.id))}
          empty={<EmptyState icon={<Receipt className="h-6 w-6" />} title={emptyTitle} description={emptyDescription} />}
        />
      </Card>

      <Modal
        open={modal === "mark-paid"}
        onClose={() => setModal(null)}
        title={`Mark ${openSelected.length} invoice${openSelected.length === 1 ? "" : "s"} as paid`}
        description="Records an offline payment for the full remaining balance of each invoice (card surcharge is removed)."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button loading={busy === "mark-paid"} onClick={() => bulk("mark-paid", openSelected.map((r) => r.id), { method, note })}>Mark paid</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Select label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CASH">Cash</option>
            <option value="CHECK">Check</option>
            <option value="OTHER">Other</option>
          </Select>
          <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </div>
      </Modal>

      <Modal
        open={modal === "write-off"}
        onClose={() => setModal(null)}
        title={`Write off ${openSelected.length} invoice${openSelected.length === 1 ? "" : "s"}`}
        description="Cancels the invoices. Members will no longer be charged for them, and overdue access blocks are lifted."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button variant="danger" loading={busy === "write-off"} onClick={() => bulk("write-off", openSelected.map((r) => r.id), { reason: note })}>Write off</Button>
          </>
        }
      >
        <Textarea label="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Modal>
    </>
  );
}

/** Serialize a `queryInvoices()` row for the client table. */
export function toInvoiceTableRow(r: {
  id: string;
  number: number;
  status: string;
  description: string | null;
  totalCents: number;
  refundedCents: number;
  dueDate: Date;
  paidAt: Date | null;
  attemptCount: number;
  nextRetryAt: Date | null;
  lastFailureReason: string | null;
  member: { id: string; firstName: string; lastName: string; email: string; status: string };
  subscription: { plan: { name: string } } | null;
  charges: Array<{ squarePaymentId: string | null; paymentMethod: { brand: string | null; last4: string | null } | null }>;
}): InvoiceTableRow {
  const c = r.charges[0];
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    description: r.description,
    totalCents: r.totalCents,
    refundedCents: r.refundedCents,
    dueDate: r.dueDate.toISOString(),
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    attemptCount: r.attemptCount,
    nextRetryAt: r.nextRetryAt ? r.nextRetryAt.toISOString() : null,
    lastFailureReason: r.lastFailureReason,
    member: r.member,
    planName: r.subscription?.plan.name ?? null,
    card: c?.paymentMethod?.brand ? `${c.paymentMethod.brand} •••• ${c.paymentMethod.last4 ?? ""}` : null,
    squarePaymentId: c?.squarePaymentId ?? null,
  };
}
