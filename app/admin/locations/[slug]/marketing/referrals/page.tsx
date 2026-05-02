import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader, Money, StatusBadge } from "@/components/ui";
import { Gift } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReferralsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const [topReferrers, pendingPayouts, paidYtd] = await Promise.all([
    prisma.referral.groupBy({
      by: ["referrerId"],
      _count: true,
      _sum: { earnedCents: true },
      orderBy: { _count: { referrerId: "desc" } },
      take: 10,
    }),
    prisma.referralPayout.findMany({
      where: { status: { in: ["PENDING", "APPROVED"] } },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.referralPayout.aggregate({
      _sum: { amountCents: true },
      where: { status: { in: ["SENT", "PAID"] }, paidAt: { gte: new Date(new Date().getFullYear(), 0, 1) } },
    }),
  ]);

  void slug;
  void location;

  return (
    <div className="space-y-6">
      <PageHeader title="Referrals" description="Each member gets a unique code & URL. Earn payments (PayPal) or membership credit." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Pending payouts</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums">{pendingPayouts.length}</div>
        </Card>
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Paid YTD</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums"><Money cents={paidYtd._sum?.amountCents ?? 0} /></div>
        </Card>
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Top referrers</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums">{topReferrers.length}</div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Pending payouts" />
        {pendingPayouts.length === 0 ? (
          <EmptyState icon={<Gift className="h-6 w-6" />} title="No pending payouts" description="Payouts are batched at month-end and require admin approval before sending via PayPal." />
        ) : (
          <ul className="mt-4 divide-y divide-apple-divider">
            {pendingPayouts.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2 text-apple-sm">
                <div>
                  <div className="font-medium text-apple-text">{p.referrerId}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">{new Date(p.periodStart).toLocaleDateString()} – {new Date(p.periodEnd).toLocaleDateString()}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Money cents={p.amountCents} className="font-medium" />
                  <StatusBadge status={p.status} size="sm" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
