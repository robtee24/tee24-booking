import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui";
import { AreaChart, BarChart, DonutChart, KpiCard } from "@/components/ui/charts";
import { Plus } from "lucide-react";
import { subscriptionsByPlan, subscriptionStatusOverTime } from "@/lib/chart-data";
import { PlansTable, type PlanRow } from "./PlansTable";

export const dynamic = "force-dynamic";

export default async function MembershipsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const [plans, planMix, statusOverTime, mrrCents, totalActive, totalCancelled] = await Promise.all([
    prisma.membershipPlan.findMany({
      where: { OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
      orderBy: [{ archived: "asc" }, { name: "asc" }],
      include: { _count: { select: { subscriptions: true } } },
    }) as unknown as Promise<PlanRow[]>,
    subscriptionsByPlan({ locationId: location.id }),
    subscriptionStatusOverTime({ locationId: location.id, months: 12 }),
    prisma.membershipSubscription.findMany({
      where: { locationId: location.id, status: "ACTIVE" },
      select: { plan: { select: { priceCents: true, billingCadence: true } } },
    }),
    prisma.membershipSubscription.count({ where: { locationId: location.id, status: "ACTIVE" } }),
    prisma.membershipSubscription.count({ where: { locationId: location.id, status: "CANCELLED" } }),
  ]);

  // Approximate MRR by normalizing each plan's price to a monthly figure
  let mrr = 0;
  for (const sub of mrrCents as Array<{ plan?: { priceCents?: number; billingCadence?: string } | null }>) {
    const price = sub.plan?.priceCents ?? 0;
    const cadence = (sub.plan?.billingCadence ?? "MONTHLY").toUpperCase();
    if (cadence === "ANNUAL" || cadence === "YEARLY") mrr += price / 12;
    else if (cadence === "QUARTERLY") mrr += price / 3;
    else if (cadence === "WEEKLY") mrr += price * 4.33;
    else mrr += price;
  }
  const churnRate = totalActive + totalCancelled > 0 ? (totalCancelled / (totalActive + totalCancelled)) * 100 : 0;

  const mrrTrend = statusOverTime.map((s) => ({ y: s.active }));


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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="Active subscriptions"
          value={totalActive.toLocaleString()}
          trend={mrrTrend}
        />
        <KpiCard
          label="MRR (estimated)"
          value={`$${(mrr / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          hint="Normalized to monthly"
        />
        <KpiCard
          label="Cancelled (lifetime)"
          value={totalCancelled.toLocaleString()}
        />
        <KpiCard
          label="Churn rate"
          value={`${churnRate.toFixed(1)}%`}
          hint="Cancelled vs total ever"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Subscriptions by plan" subtitle={`${totalActive} active`} />
          <div className="mt-2">
            {planMix.length === 0 ? (
              <p className="py-8 text-center text-apple-sm text-apple-text-tertiary">No active subscriptions yet.</p>
            ) : (
              <DonutChart data={planMix} centerValue={totalActive.toLocaleString()} centerLabel="Active" height={220} />
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Subscriptions over time" subtitle="Last 12 months" />
          <div className="mt-4">
            <AreaChart
              data={statusOverTime}
              xKey="month"
              series={[
                { key: "active", label: "Active" },
                { key: "frozen", label: "Frozen" },
                { key: "cancelled", label: "Cancelled" },
              ]}
              stacked
              showLegend
              height={220}
            />
          </div>
        </Card>
      </div>

      {planMix.length > 0 && (
        <Card>
          <CardHeader title="Plan popularity" subtitle="Active subscribers per plan" />
          <div className="mt-4">
            <BarChart
              data={planMix.map((p) => ({ name: p.name, members: p.value }))}
              xKey="name"
              series={[{ key: "members", label: "Members" }]}
              height={220}
              colorByCell
            />
          </div>
        </Card>
      )}

      <Card padded={false}>
        <PlansTable plans={plans} newHref={`/admin/locations/${slug}/members/memberships/new`} />
      </Card>
    </div>
  );
}
