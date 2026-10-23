"use client";

import Link from "next/link";
import { Button, Card, DataTable, EmptyState, Money, StatusBadge, type Column } from "@/components/ui";
import { Tag } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";

export type DiscountRow = {
  id: string;
  code: string;
  name: string;
  description: string; // from describeDiscount()
  planNames: string[];
  signupFormCount: number;
  startsAt: string | null;
  endsAt: string | null;
  totalRedemptions: number;
  maxRedemptions: number | null;
  activeMembers: number;
  savedCents: number;
  status: string; // ACTIVE | EXPIRED | FROZEN (exhausted) | SCHEDULED | CANCELLED
};

export function DiscountTable({ slug, rows, currency }: { slug: string; rows: DiscountRow[]; currency: string }) {
  const cols: Column<DiscountRow>[] = [
    {
      key: "code",
      header: "Code",
      cell: (r) => (
        <div>
          <Link href={adminRoutes.loc.billing.discountDetail(slug, r.id)} className="font-mono font-medium text-apple-text hover:underline">{r.code}</Link>
          <div className="text-apple-xs text-apple-text-tertiary">{r.name}</div>
        </div>
      ),
    },
    { key: "discount", header: "Discount", cell: (r) => <span className="text-apple-sm text-apple-text">{r.description}</span> },
    {
      key: "eligibility",
      header: "Eligibility",
      cell: (r) => (
        <div className="text-apple-xs text-apple-text-secondary">
          <div>{r.planNames.length === 0 ? "All plans" : r.planNames.join(", ")}</div>
          {r.signupFormCount > 0 && <div>{r.signupFormCount} signup form(s)</div>}
          {(r.startsAt || r.endsAt) && <div>{r.startsAt ? `from ${new Date(r.startsAt).toLocaleDateString()}` : ""} {r.endsAt ? `until ${new Date(r.endsAt).toLocaleDateString()}` : ""}</div>}
        </div>
      ),
    },
    {
      key: "usage",
      header: "Usage",
      align: "right",
      cell: (r) => (
        <div className="text-apple-sm">
          <div className="tabular-nums text-apple-text">{r.totalRedemptions}{r.maxRedemptions ? ` / ${r.maxRedemptions}` : ""}</div>
          <div className="text-apple-xs text-apple-text-tertiary">{r.activeMembers} enrolled · <Money cents={r.savedCents} currency={currency} /> saved</div>
        </div>
      ),
    },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} size="sm" /> },
  ];

  return (
    <Card padded={false}>
      <DataTable
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        empty={
          <EmptyState
            icon={<Tag className="h-6 w-6" />}
            title="No discounts yet"
            description="Create a code members can enter at signup, or an automatic discount attached to a signup form."
            action={<Link href={adminRoutes.loc.billing.discountNew(slug)}><Button size="sm">New discount</Button></Link>}
          />
        }
      />
    </Card>
  );
}
