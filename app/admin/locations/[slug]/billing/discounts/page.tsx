import { getPrisma } from "@/lib/db";
import { Card, DataTable, EmptyState, PageHeader, Button, StatusBadge, type Column } from "@/components/ui";
import { Plus, Tag } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DiscountsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const discounts = await prisma.discount.findMany({
    where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
    orderBy: [{ active: "desc" }, { code: "asc" }],
    include: { _count: { select: { applications: true, planRestrictions: true } } },
  });

  const cols: Column<typeof discounts[number]>[] = [
    { key: "code", header: "Code", cell: (r) => <span className="font-mono font-medium text-apple-text">{r.code}</span> },
    { key: "name", header: "Name", cell: (r) => <span className="text-apple-text">{r.name}</span> },
    { key: "type", header: "Discount", cell: (r) => <span className="text-apple-sm">{r.type === "PERCENT" ? `${r.value}%` : `$${(r.value / 100).toFixed(2)}`}</span> },
    { key: "scope", header: "Scope", cell: (r) => <span className="text-apple-xs text-apple-text-secondary">{r.scope}</span> },
    { key: "restrictions", header: "Plan restrictions", cell: (r) => <span className="text-apple-xs">{r._count.planRestrictions === 0 ? "All plans" : `${r._count.planRestrictions} plan(s)`}</span> },
    { key: "redeemed", header: "Redeemed", align: "right", cell: (r) => <span className="tabular-nums">{r.totalRedemptions}</span> },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.active ? "ACTIVE" : "CANCELLED"} size="sm" /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Discounts" description="Codes and automatic discounts. Restrict by plan to control eligibility." actions={<Button iconLeft={<Plus className="h-4 w-4" />}>New discount</Button>} />
      <Card padded={false}>
        <DataTable columns={cols} rows={discounts} rowKey={(r) => r.id} empty={<EmptyState icon={<Tag className="h-6 w-6" />} title="No discounts yet" />} />
      </Card>
    </div>
  );
}
