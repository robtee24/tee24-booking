import { Suspense } from "react";
import { Card, CardHeader, PageHeader, Button } from "@/components/ui";
import { AreaChart, BarChart, DonutChart } from "@/components/ui/charts";
import { Plus, ScanLine, Upload } from "lucide-react";
import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { adminRoutes } from "@/lib/admin/routes";
import { memberGrowth, memberStatusBreakdown } from "@/lib/chart-data";
import MembersListClient from "./MembersListClient";

export const dynamic = "force-dynamic";

export default async function MembersListPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug }, select: { id: true, organizationId: true } });

  if (!location) {
    return (
      <div className="space-y-6">
        <PageHeader title="Members" />
      </div>
    );
  }

  const [statusBreakdown, growth, sourceRows, totalMembers, plans] = await Promise.all([
    memberStatusBreakdown({ locationId: location.id }),
    memberGrowth({ locationId: location.id, months: 12 }),
    prisma.member.groupBy({
      by: ["source"],
      where: { locationId: location.id },
      _count: { _all: true },
    }),
    prisma.member.count({ where: { locationId: location.id } }),
    prisma.membershipPlan.findMany({
      where: { archived: false, OR: [{ organizationId: location.organizationId }, { organizationId: null }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const sourceData = sourceRows
    .map((r: any) => ({
      source: r.source ?? "Unknown",
      members: r._count?._all ?? 0,
    }))
    .sort((a, b) => b.members - a.members)
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description="Members, visitors, frozen, and cancelled accounts"
        actions={
          <>
            <Link href={adminRoutes.loc.frontDesk(slug)}>
              <Button variant="secondary" iconLeft={<ScanLine className="h-4 w-4" />}>Front desk</Button>
            </Link>
            <Link href={adminRoutes.loc.members.import(slug)}>
              <Button variant="secondary" iconLeft={<Upload className="h-4 w-4" />}>Import</Button>
            </Link>
            <Link href={adminRoutes.loc.members.new(slug)}>
              <Button iconLeft={<Plus className="h-4 w-4" />}>Add member</Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Status breakdown" subtitle={`${totalMembers.toLocaleString()} total`} />
          <div className="mt-2">
            <DonutChart
              data={statusBreakdown}
              useStatusColors
              centerValue={totalMembers.toLocaleString()}
              centerLabel="Members"
              height={220}
            />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Member growth" subtitle="Active members over the last 12 months" />
          <div className="mt-4">
            <AreaChart
              data={growth}
              xKey="month"
              series={[
                { key: "active", label: "Members" },
                { key: "visitor", label: "Visitors" },
              ]}
              stacked
              showLegend
              height={220}
            />
          </div>
        </Card>
      </div>

      {sourceData.length > 0 && (
        <Card>
          <CardHeader
            title="Acquisition source"
            subtitle="How members found you (top sources)"
          />
          <div className="mt-4">
            <BarChart
              data={sourceData}
              xKey="source"
              series={[{ key: "members", label: "Members" }]}
              height={220}
              colorByCell
            />
          </div>
        </Card>
      )}

      <Suspense fallback={<div className="h-64 animate-pulse rounded-apple bg-apple-fill-secondary" />}>
        <MembersListClient slug={slug} plans={plans} />
      </Suspense>
    </div>
  );
}
