"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Select } from "@/components/ui";
import { Download, Filter, X } from "lucide-react";

export const INVOICE_FILTER_KEYS = ["q", "number", "txn", "last4", "memberStatus", "scheduledFrom", "scheduledTo", "paidFrom", "paidTo", "memberId"] as const;
export type InvoiceFilterKey = (typeof INVOICE_FILTER_KEYS)[number];

/**
 * Filter bar for the Payments page. Writes filters to the URL so the server
 * page re-queries; "Export CSV" links to the admin invoices API with the same
 * params.
 */
export function InvoiceFilters({ slug, memberName }: { slug: string; memberName?: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Record<string, string>>(() => Object.fromEntries(INVOICE_FILTER_KEYS.map((k) => [k, sp.get(k) ?? ""])));

  const activeCount = INVOICE_FILTER_KEYS.filter((k) => k !== "memberId" && sp.get(k)).length;

  function apply(next: Record<string, string>) {
    const params = new URLSearchParams(sp.toString());
    for (const k of INVOICE_FILTER_KEYS) {
      if (next[k]) params.set(k, next[k]);
      else params.delete(k);
    }
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  function clear() {
    const cleared = Object.fromEntries(INVOICE_FILTER_KEYS.map((k) => [k, ""]));
    setDraft(cleared);
    apply(cleared);
  }

  const csvParams = new URLSearchParams(sp.toString());
  csvParams.set("locationSlug", slug);
  csvParams.set("format", "csv");
  if (!csvParams.get("tab")) csvParams.set("tab", "ALL");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply(draft);
          }}
        >
          <Input
            placeholder="Search member name or email…"
            value={draft.q}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        <Button variant={activeCount ? "primary" : "secondary"} iconLeft={<Filter className="h-4 w-4" />} onClick={() => setOpen((o) => !o)}>
          Filters{activeCount ? ` (${activeCount})` : ""}
        </Button>
        <a href={`/api/admin/invoices?${csvParams.toString()}`} className="inline-flex">
          <Button variant="secondary" iconLeft={<Download className="h-4 w-4" />} type="button">Export CSV</Button>
        </a>
      </div>

      {sp.get("memberId") && (
        <div className="flex items-center gap-2 text-apple-sm">
          <span className="rounded-apple-pill bg-apple-fill-secondary px-3 py-1 text-apple-text">
            Showing invoices for <strong>{memberName ?? "member"}</strong>
          </span>
          <Button size="sm" variant="ghost" iconLeft={<X className="h-3.5 w-3.5" />} onClick={() => apply({ ...draft, memberId: "" })}>Show all</Button>
        </div>
      )}

      {open && (
        <div className="rounded-apple border border-apple-border bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input label="Invoice #" value={draft.number} onChange={(e) => setDraft((d) => ({ ...d, number: e.target.value }))} />
            <Input label="Transaction id" value={draft.txn} onChange={(e) => setDraft((d) => ({ ...d, txn: e.target.value }))} placeholder="Square payment id" />
            <Input label="Card last 4" value={draft.last4} maxLength={4} onChange={(e) => setDraft((d) => ({ ...d, last4: e.target.value.replace(/\D/g, "") }))} />
            <Select label="Member status" value={draft.memberStatus} onChange={(e) => setDraft((d) => ({ ...d, memberStatus: e.target.value }))}>
              <option value="">Any</option>
              <option value="ACTIVE">Active</option>
              <option value="PENDING">Pending</option>
              <option value="FROZEN">Frozen</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="VISITOR">Visitor</option>
            </Select>
            <Input label="Scheduled from" type="date" value={draft.scheduledFrom} onChange={(e) => setDraft((d) => ({ ...d, scheduledFrom: e.target.value }))} />
            <Input label="Scheduled to" type="date" value={draft.scheduledTo} onChange={(e) => setDraft((d) => ({ ...d, scheduledTo: e.target.value }))} />
            <Input label="Paid from" type="date" value={draft.paidFrom} onChange={(e) => setDraft((d) => ({ ...d, paidFrom: e.target.value }))} />
            <Input label="Paid to" type="date" value={draft.paidTo} onChange={(e) => setDraft((d) => ({ ...d, paidTo: e.target.value }))} />
          </div>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={clear}>Clear all</Button>
            <Button onClick={() => apply(draft)}>Apply filters</Button>
          </div>
        </div>
      )}
    </div>
  );
}
