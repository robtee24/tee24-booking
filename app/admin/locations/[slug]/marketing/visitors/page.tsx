import { getPrisma } from "@/lib/db";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { UserPlus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function VisitorsFunnelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({ where: { slug } });
  if (!location) return null;

  const [stages, recent] = await Promise.all([
    prisma.visitor.groupBy({
      by: ["stage"],
      _count: true,
      where: { locationId: location.id },
    }),
    prisma.visitor.findMany({
      where: { locationId: location.id },
      orderBy: { updatedAt: "desc" },
      take: 25,
    }),
  ]);

  const order = ["NEW", "ENGAGED", "CONVERTED", "LOST"];
  const counts = Object.fromEntries(stages.map((s) => [s.stage, s._count]));

  return (
    <div className="space-y-6">
      <PageHeader title="Visitors funnel" description="Day-pass buyers, free-pass guests, and inquiries on their way to membership." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {order.map((stage) => (
          <Card key={stage}>
            <div className="text-apple-xs uppercase text-apple-text-tertiary">{stage}</div>
            <div className="mt-1 text-apple-2xl font-semibold tabular-nums">{counts[stage] ?? 0}</div>
          </Card>
        ))}
      </div>

      <Card>
        {recent.length === 0 ? (
          <EmptyState icon={<UserPlus className="h-6 w-6" />} title="No visitors yet" description="Visitors are auto-created from day-pass purchases and signup-form starts." />
        ) : (
          <ul className="divide-y divide-apple-divider">
            {recent.map((v) => (
              <li key={v.id} className="flex items-center justify-between py-2 text-apple-sm">
                <div>
                  <div className="font-medium text-apple-text">{v.firstName ?? "(no name)"} {v.lastName ?? ""}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">{v.email ?? v.phone ?? "—"} · {v.source ?? "direct"}</div>
                </div>
                <StatusBadge status={v.stage} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
