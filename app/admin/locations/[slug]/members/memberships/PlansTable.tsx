"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Package, Pencil } from "lucide-react";
import { Button, DataTable, EmptyState, Input, Modal, Select, StatusBadge, Money, useToast, type Column } from "@/components/ui";

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
  visitsPerPeriod: number | null;
  visitPeriod: string;
  _count: { subscriptions: number };
};

const visitLabel = (r: PlanRow) => (r.visitsPerPeriod == null ? "Unlimited" : `${r.visitsPerPeriod} / ${r.visitPeriod === "ROLLING_WEEK" ? "week" : "month"}`);

export function PlansTable({ plans, newHref }: { plans: PlanRow[]; newHref: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<PlanRow | null>(null);
  const [visits, setVisits] = React.useState("");
  const [period, setPeriod] = React.useState("ROLLING_MONTH");
  const [saving, setSaving] = React.useState(false);

  function open(r: PlanRow) {
    setVisits(r.visitsPerPeriod?.toString() ?? "");
    setPeriod(r.visitPeriod || "ROLLING_MONTH");
    setEditing(r);
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/memberships/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitsPerPeriod: visits ? Number(visits) : null, visitPeriod: period }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      toast({ tone: "success", title: "Visit allowance updated" });
      setEditing(null);
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't update plan", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

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
      key: "visits",
      header: "Visits",
      cell: (r) => (
        <button type="button" onClick={() => open(r)} className="group inline-flex items-center gap-1 text-apple-sm text-apple-text-secondary hover:text-apple-text" title="Edit visit allowance">
          {visitLabel(r)}
          <Pencil size={12} className="opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      ),
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

  return (
    <>
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
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Visit allowance · ${editing.name}` : "Visit allowance"}
        description="Enforced when members unlock the door from the app. Counts distinct calendar days, rolling from each member's signup day."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button loading={saving} onClick={save}>Save</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Visits per period" type="number" min="1" max="365" value={visits} onChange={(e) => setVisits(e.target.value)} placeholder="Unlimited" />
          <Select label="Period" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="ROLLING_MONTH">Rolling month</option>
            <option value="ROLLING_WEEK">Rolling week</option>
          </Select>
        </div>
      </Modal>
    </>
  );
}
