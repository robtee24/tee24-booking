"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { Download } from "lucide-react";

/** Date-range picker + CSV export for the accounting ledger. Writes `from`/`to` to the URL. */
export function LedgerFilters({ slug, from, to }: { slug: string; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [draft, setDraft] = React.useState({ from, to });

  function apply(next: { from: string; to: string }) {
    const params = new URLSearchParams(sp.toString());
    params.set("from", next.from);
    params.set("to", next.to);
    router.push(`${pathname}?${params.toString()}`);
  }

  function preset(kind: "month" | "last-month" | "quarter" | "year") {
    const now = new Date();
    let s: Date, e: Date;
    if (kind === "month") { s = new Date(now.getFullYear(), now.getMonth(), 1); e = new Date(now.getFullYear(), now.getMonth() + 1, 0); }
    else if (kind === "last-month") { s = new Date(now.getFullYear(), now.getMonth() - 1, 1); e = new Date(now.getFullYear(), now.getMonth(), 0); }
    else if (kind === "quarter") { const q = Math.floor(now.getMonth() / 3) * 3; s = new Date(now.getFullYear(), q, 1); e = new Date(now.getFullYear(), q + 3, 0); }
    else { s = new Date(now.getFullYear(), 0, 1); e = new Date(now.getFullYear(), 11, 31); }
    const next = { from: iso(s), to: iso(e) };
    setDraft(next);
    apply(next);
  }

  const csv = new URLSearchParams({ locationSlug: slug, from, to, format: "csv" });

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input label="From" type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
      <Input label="To" type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
      <Button variant="secondary" onClick={() => apply(draft)}>Apply</Button>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" onClick={() => preset("month")}>This month</Button>
        <Button size="sm" variant="ghost" onClick={() => preset("last-month")}>Last month</Button>
        <Button size="sm" variant="ghost" onClick={() => preset("quarter")}>Quarter</Button>
        <Button size="sm" variant="ghost" onClick={() => preset("year")}>Year</Button>
      </div>
      <a href={`/api/admin/billing/accounting?${csv.toString()}`} className="ml-auto inline-flex">
        <Button variant="secondary" iconLeft={<Download className="h-4 w-4" />} type="button">Export CSV</Button>
      </a>
    </div>
  );
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
