import { Card, CardHeader, EmptyState, StatusBadge } from "@/components/ui";
import { getCurrentMember } from "@/lib/member-session";
import { getPrisma } from "@/lib/db";
import { Activity } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PortalAttendance() {
  const member = await getCurrentMember();
  if (!member) return null;
  const prisma = getPrisma();

  const [visits, latestTier, count90d] = await Promise.all([
    prisma.visit.findMany({
      where: { memberId: member.id },
      orderBy: { enteredAt: "desc" },
      take: 30,
      include: { bay: { select: { number: true } }, location: { select: { name: true } } },
    }),
    prisma.usageTierSnapshot.findFirst({ where: { memberId: member.id }, orderBy: { computedAt: "desc" } }),
    prisma.visit.count({
      where: {
        memberId: member.id,
        enteredAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-apple-2xl font-semibold tracking-tight">Attendance</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Visits last 90d</div>
          <div className="mt-1 text-apple-2xl font-semibold tabular-nums">{count90d}</div>
        </Card>
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Usage tier</div>
          <div className="mt-1">{latestTier ? <StatusBadge status={latestTier.tier} /> : <span className="text-apple-text-tertiary">—</span>}</div>
        </Card>
        <Card>
          <div className="text-apple-xs uppercase text-apple-text-tertiary">Last visit</div>
          <div className="mt-1 text-apple-base font-medium">{visits[0] ? new Date(visits[0].enteredAt).toLocaleDateString() : "—"}</div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent visits" />
        {visits.length === 0 ? (
          <EmptyState icon={<Activity className="h-6 w-6" />} title="No visits yet" />
        ) : (
          <ul className="mt-3 divide-y divide-apple-divider">
            {visits.map((v) => (
              <li key={v.id} className="flex items-center justify-between py-2 text-apple-sm">
                <div>
                  <div className="text-apple-text">{new Date(v.enteredAt).toLocaleString()}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">{v.location.name} {v.bay && `· Bay ${v.bay.number}`}</div>
                </div>
                <StatusBadge status={v.type} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
