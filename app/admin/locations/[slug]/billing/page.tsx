import { getPrisma } from "@/lib/db";
import { Card, CardHeader, PageHeader, Money, StatusBadge } from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function BillingOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [paidMtd, paidPrev, scheduledMtd, overdue, upcoming, recentPayments] = await Promise.all([
    prisma.invoice.aggregate({ _sum: { totalCents: true }, where: { locationId: location.id, status: "PAID", paidAt: { gte: monthStart } } }),
    prisma.invoice.aggregate({ _sum: { totalCents: true }, where: { locationId: location.id, status: "PAID", paidAt: { gte: lastMonthStart, lt: monthStart } } }),
    prisma.invoice.aggregate({ _sum: { totalCents: true }, where: { locationId: location.id, status: "SCHEDULED", dueDate: { gte: monthStart, lt: new Date(now.getFullYear(), now.getMonth() + 1, 1) } } }),
    prisma.invoice.aggregate({ _sum: { totalCents: true }, _count: true, where: { locationId: location.id, status: { in: ["PAST_DUE", "FAILED"] } } }),
    prisma.invoice.findMany({
      where: { locationId: location.id, status: "SCHEDULED", dueDate: { gte: now } },
      orderBy: { dueDate: "asc" },
      take: 5,
      include: { member: { select: { firstName: true, lastName: true, id: true } } },
    }),
    prisma.invoice.findMany({
      where: { locationId: location.id, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } },
      orderBy: { paidAt: "desc" },
      take: 5,
      include: { member: { select: { firstName: true, lastName: true, id: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" description="Income, recurring revenue, and overdue accounts." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Paid MTD</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums">
            <Money cents={paidMtd._sum?.totalCents ?? 0} />
          </div>
          <div className="mt-1 text-apple-xs text-apple-text-tertiary">vs last month <Money cents={paidPrev._sum?.totalCents ?? 0} /></div>
        </Card>
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Scheduled this month</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums"><Money cents={scheduledMtd._sum?.totalCents ?? 0} /></div>
        </Card>
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Overdue</div>
          <div className={`mt-1 text-apple-2xl font-semibold tabular-nums ${overdue._count ? "text-apple-red" : ""}`}>
            <Money cents={overdue._sum?.totalCents ?? 0} />
          </div>
          <div className="mt-1 text-apple-xs text-apple-text-tertiary">{overdue._count} invoice{overdue._count === 1 ? "" : "s"}</div>
        </Card>
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Quick links</div>
          <div className="mt-2 flex flex-col gap-1 text-apple-sm">
            <Link href={`/admin/locations/${slug}/billing/payments`} className="text-apple-blue hover:underline">All payments →</Link>
            <Link href={`/admin/locations/${slug}/billing/recurring`} className="text-apple-blue hover:underline">Recurring →</Link>
            <Link href={`/admin/locations/${slug}/billing/discounts`} className="text-apple-blue hover:underline">Discounts →</Link>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming invoices" />
          {upcoming.length === 0 ? <p className="mt-3 text-apple-sm text-apple-text-tertiary">Nothing due soon.</p> : (
            <ul className="mt-3 divide-y divide-apple-divider">
              {upcoming.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2 text-apple-sm">
                  <div>
                    <div className="font-medium text-apple-text">{i.member.firstName} {i.member.lastName}</div>
                    <div className="text-apple-xs text-apple-text-tertiary">Due {new Date(i.dueDate).toLocaleDateString()}</div>
                  </div>
                  <Money cents={i.totalCents} className="font-medium" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent payments" />
          {recentPayments.length === 0 ? <p className="mt-3 text-apple-sm text-apple-text-tertiary">No recent payments.</p> : (
            <ul className="mt-3 divide-y divide-apple-divider">
              {recentPayments.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2 text-apple-sm">
                  <div>
                    <div className="font-medium text-apple-text">{i.member.firstName} {i.member.lastName}</div>
                    <div className="text-apple-xs text-apple-text-tertiary">{i.paidAt && new Date(i.paidAt).toLocaleDateString()}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Money cents={i.totalCents} className="font-medium" />
                    <StatusBadge status={i.status} size="sm" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
