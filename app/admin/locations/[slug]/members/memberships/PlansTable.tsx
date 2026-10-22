"use client";

import Link from "next/link";
import { Plus, Package } from "lucide-react";
import { Button, DataTable, EmptyState, StatusBadge, Money, type Column } from "@/components/ui";

export type PlanRow = {
  id: string;
  name: string;
  productType: string;
  category: string;
  priceCents: number;
  signupFeeCents: number;
  billingCadence: string;
  archived: boolean;
  durationDays: number | null;
  _count: { subscriptions: number };
};

const cols: Column<PlanRow>[] = [
  {
    key: "name",
    header: "Plan",
    cell: (r) => (
      <div>
        <div className="font-medium text-apple-text">{r.name}</div>
        <div className="text-apple-xs text-apple-text-tertiary">
          {r.productType.replace("_", " ")} · {r.category}
        </div>
      </div>
    ),
  },
  {
    key: "price",
    header: "Price",
    cell: (r) => (
      <div>
        <Money cents={r.priceCents} className="font-medium text-apple-text" />
        <div className="text-apple-xs text-apple-text-tertiary">/ {r.billingCadence.toLowerCase()}</div>
      </div>
    ),
  },
  {
    key: "signup",
    header: "Signup fee",
    cell: (r) => <Money cents={r.signupFeeCents} className="text-apple-sm text-apple-text-secondary" />,
  },
  {
    key: "duration",
    header: "Duration",
    cell: (r) => <span className="text-apple-sm text-apple-text-secondary">{r.durationDays ? `${r.durationDays} days` : "—"}</span>,
  },
  {
    key: "subs",
    header: "Active subs",
    align: "right",
    cell: (r) => <span className="tabular-nums text-apple-text">{r._count.subscriptions}</span>,
  },
  {
    key: "status",
    header: "Status",
    cell: (r) => (r.archived ? <StatusBadge status="CANCELLED" size="sm" /> : <StatusBadge status="ACTIVE" size="sm" />),
  },
];

export function PlansTable({ plans, newHref }: { plans: PlanRow[]; newHref: string }) {
  return (
    <DataTable
      columns={cols}
      rows={plans}
      rowKey={(p) => p.id}
      empty={
        <EmptyState
          icon={<Package className="h-6 w-6" />}
          title="No plans yet"
          description="Create your first membership, day pass, or visitor pass."
          action={
            <Link href={newHref}>
              <Button iconLeft={<Plus className="h-4 w-4" />}>New plan</Button>
            </Link>
          }
        />
      }
    />
  );
}
