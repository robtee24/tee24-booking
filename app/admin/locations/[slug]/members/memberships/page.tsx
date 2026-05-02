import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { Button, Card, DataTable, EmptyState, PageHeader, StatusBadge, Money, type Column } from "@/components/ui";
import { Plus, Package } from "lucide-react";

export const dynamic = "force-dynamic";

type PlanRow = {
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

export default async function MembershipsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const plans = await prisma.membershipPlan.findMany({
    where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
    orderBy: [{ archived: "asc" }, { name: "asc" }],
    include: { _count: { select: { subscriptions: true } } },
  }) as unknown as PlanRow[];

  const cols: Column<PlanRow>[] = [
    {
      key: "name",
      header: "Plan",
      cell: (r) => (
        <div>
          <div className="font-medium text-apple-text">{r.name}</div>
          <div className="text-apple-xs text-apple-text-tertiary">{r.productType.replace("_", " ")} · {r.category}</div>
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
      cell: (r) => r.archived ? <StatusBadge status="CANCELLED" size="sm" /> : <StatusBadge status="ACTIVE" size="sm" />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Memberships"
        description="Plans, day passes, and visitor passes you sell."
        actions={
          <Link href={`/admin/locations/${slug}/members/memberships/new`}>
            <Button iconLeft={<Plus className="h-4 w-4" />}>New plan</Button>
          </Link>
        }
      />
      <Card padded={false}>
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
                <Link href={`/admin/locations/${slug}/members/memberships/new`}>
                  <Button iconLeft={<Plus className="h-4 w-4" />}>New plan</Button>
                </Link>
              }
            />
          }
        />
      </Card>
    </div>
  );
}
