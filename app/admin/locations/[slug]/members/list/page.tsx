import { Card, CardHeader, PageHeader, Button } from "@/components/ui";
import { AreaChart, BarChart, DonutChart } from "@/components/ui/charts";
import { Plus, Download } from "lucide-react";
import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { memberGrowth, memberStatusBreakdown } from "@/lib/chart-data";
import MembersListClient from "./MembersListClient";

export const dynamic = "force-dynamic";

export default async function MembersListPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });

  if (!location) {
    return (
      <div className="space-y-6">
        <PageHeader title="Members" />
      </div>
    );
  }

  const [statusBreakdown, growth, sourceRows, totalMembers] = await Promise.all([
    memberStatusBreakdown({ locationId: location.id }),
    memberGrowth({ locationId: location.id, months: 12 }),
    prisma.member.groupBy({
      by: ["source"],
      where: { locationId: location.id },
      _count: { _all: true },
    }),
    prisma.member.count({ where: { locationId: location.id } }),
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
            <Button variant="secondary" iconLeft={<Download className="h-4 w-4" />}>
              Export
            </Button>
            <Link href={`/admin/locations/${slug}/members/list/new`}>
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

      <MembersListClient />
    </div>
  );
}
