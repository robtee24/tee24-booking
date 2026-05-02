import { getPrisma } from "@/lib/db";
import Link from "next/link";
import { Card, DataTable, EmptyState, PageHeader, Money, StatusBadge, type Column } from "@/components/ui";
import { Receipt } from "lucide-react";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  number: number;
  status: string;
  totalCents: number;
  dueDate: Date;
  paidAt: Date | null;
  member: { id: string; firstName: string; lastName: string };
};

export default async function PaymentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const invoices = await prisma.invoice.findMany({
    where: { locationId: location.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { member: { select: { id: true, firstName: true, lastName: true } } },
  });

  const cols: Column<Row>[] = [
    { key: "n", header: "#", cell: (r) => <span className="font-mono text-apple-xs text-apple-text-secondary">{r.number}</span>, width: "80px" },
    {
      key: "member",
      header: "Member",
      cell: (r) => (
        <Link href={`/admin/locations/${slug}/members/list/${r.member.id}`} className="font-medium text-apple-text hover:underline">
          {r.member.firstName} {r.member.lastName}
        </Link>
      ),
    },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} size="sm" /> },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <Money cents={r.totalCents} className="font-medium" /> },
    { key: "due", header: "Due / Paid", cell: (r) => <span className="text-apple-sm text-apple-text-secondary">{r.paidAt ? `Paid ${new Date(r.paidAt).toLocaleDateString()}` : `Due ${new Date(r.dueDate).toLocaleDateString()}`}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Payments" description="All charges, refunds, and chargebacks." />
      <Card padded={false}>
        <DataTable columns={cols} rows={invoices as any} rowKey={(r) => r.id} empty={<EmptyState icon={<Receipt className="h-6 w-6" />} title="No payments yet" />} />
      </Card>
    </div>
  );
}
