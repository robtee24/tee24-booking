import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { Card, DataTable, EmptyState, PageHeader, Button, StatusBadge, Money, type Column } from "@/components/ui";
import { KpiCard } from "@/components/ui/charts";
import { Plus, Tag } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { describeDiscount, listDiscounts } from "@/services/discount.service";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof listDiscounts>>[number] & { savedCents: number; activeMembers: number };

export default async function DiscountsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const discounts = await listDiscounts(location.organizationId);
  const ids = discounts.map((d) => d.id);
  const [saved, enrolled] = await Promise.all([
    ids.length ? prisma.discountApplication.groupBy({ by: ["discountId"], where: { discountId: { in: ids }, invoiceId: { not: null } }, _sum: { amountCents: true } }) : [],
    ids.length ? prisma.discountApplication.groupBy({ by: ["discountId"], where: { discountId: { in: ids }, invoiceId: null }, _count: { _all: true } }) : [],
  ]);
  const savedBy = new Map(saved.map((s) => [s.discountId, s._sum.amountCents ?? 0]));
  const enrolledBy = new Map(enrolled.map((s) => [s.discountId, s._count._all]));
  const rows: Row[] = discounts.map((d) => ({ ...d, savedCents: savedBy.get(d.id) ?? 0, activeMembers: enrolledBy.get(d.id) ?? 0 }));

  const totalSaved = rows.reduce((s, r) => s + r.savedCents, 0);
  const totalRedemptions = rows.reduce((s, r) => s + r.totalRedemptions, 0);
  const now = new Date();

  const cols: Column<Row>[] = [
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
    { key: "discount", header: "Discount", cell: (r) => <span className="text-apple-sm text-apple-text">{describeDiscount(r)}</span> },
    {
      key: "eligibility",
      header: "Eligibility",
      cell: (r) => (
        <div className="text-apple-xs text-apple-text-secondary">
          <div>{r.planRestrictions.length === 0 ? "All plans" : r.planRestrictions.map((p) => p.plan.name).join(", ")}</div>
          {Array.isArray(r.signupFormIds) && (r.signupFormIds as string[]).length > 0 && <div>{(r.signupFormIds as string[]).length} signup form(s)</div>}
          {(r.startsAt || r.endsAt) && (
            <div>{r.startsAt ? `from ${r.startsAt.toLocaleDateString()}` : ""} {r.endsAt ? `until ${r.endsAt.toLocaleDateString()}` : ""}</div>
          )}
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
          <div className="text-apple-xs text-apple-text-tertiary">{r.activeMembers} enrolled · <Money cents={r.savedCents} currency={location.currency} /> saved</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => {
        const expired = r.endsAt && r.endsAt < now;
        const notStarted = r.startsAt && r.startsAt > now;
        const exhausted = r.maxRedemptions != null && r.totalRedemptions >= r.maxRedemptions;
        return <StatusBadge status={!r.active ? "CANCELLED" : expired ? "EXPIRED" : exhausted ? "FROZEN" : notStarted ? "SCHEDULED" : "ACTIVE"} size="sm" />;
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discounts"
        description="Promo codes for signup and recurring billing. Restrict by plan or signup form to control eligibility."
        actions={
          <Link href={adminRoutes.loc.billing.discountNew(slug)}>
            <Button iconLeft={<Plus className="h-4 w-4" />}>New discount</Button>
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiCard label="Active codes" value={rows.filter((r) => r.active).length} />
        <KpiCard label="Redemptions" value={totalRedemptions} />
        <KpiCard label="Total discounted" value={`$${(totalSaved / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} hint="across all invoices" />
      </div>
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
    </div>
  );
}
