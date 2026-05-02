import { getPrisma } from "@/lib/db";
import Link from "next/link";
import { Card, DataTable, EmptyState, PageHeader, Money, StatusBadge, type Column } from "@/components/ui";
import { RefreshCw } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function RecurringPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const subs = await prisma.membershipSubscription.findMany({
    where: { locationId: location.id, status: { in: ["ACTIVE", "CANCEL_SCHEDULED", "FROZEN"] } },
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    take: 200,
    include: { member: { select: { id: true, firstName: true, lastName: true } }, plan: { select: { name: true } } },
  });

  const cols: Column<typeof subs[number]>[] = [
    {
      key: "member",
      header: "Member",
      cell: (r) => (
        <Link href={`/admin/locations/${slug}/members/list/${r.member.id}`} className="font-medium text-apple-text hover:underline">
          {r.member.firstName} {r.member.lastName}
        </Link>
      ),
    },
    { key: "plan", header: "Plan", cell: (r) => <span className="text-apple-text">{r.plan.name}</span> },
    { key: "price", header: "Price", align: "right", cell: (r) => <span className="text-apple-sm"><Money cents={r.priceCents} /> / {r.billingCadence.toLowerCase()}</span> },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} size="sm" /> },
    { key: "next", header: "Paid through", cell: (r) => <span className="text-apple-sm text-apple-text-secondary">{r.paidThroughDate ? new Date(r.paidThroughDate).toLocaleDateString() : "—"}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Recurring" description="Active and scheduled subscriptions." />
      <Card padded={false}>
        <DataTable columns={cols} rows={subs} rowKey={(r) => r.id} empty={<EmptyState icon={<RefreshCw className="h-6 w-6" />} title="No active subscriptions" />} />
      </Card>
    </div>
  );
}
