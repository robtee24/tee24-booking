import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { Wrench } from "lucide-react";
import { MaintenanceComposer } from "./MaintenanceComposer";

export const dynamic = "force-dynamic";

export default async function MaintenancePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prisma = getPrisma();
  const location = await prisma.location.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });
  if (!location) return null;

  const [logs, bays] = await Promise.all([
    prisma.maintenanceLog.findMany({
      where: { locationId: location.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { bay: { select: { number: true } } },
    }),
    prisma.bay.findMany({ where: { locationId: location.id }, select: { id: true, number: true } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Maintenance" description="Per-bay equipment & maintenance log." />
      <MaintenanceComposer locationId={location.id} bays={bays} />
      <Card padded={false}>
        <CardHeader title="History" className="p-5" />
        {logs.length === 0 ? (
          <EmptyState icon={<Wrench className="h-6 w-6" />} title="No log entries yet" />
        ) : (
          <ul className="divide-y divide-apple-divider">
            {logs.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-3 p-4 text-apple-sm">
                <div>
                  <div className="font-medium text-apple-text">
                    {l.bay ? `Bay ${l.bay.number}` : "General"} — {l.kind}
                  </div>
                  <p className="mt-1 text-apple-text-secondary whitespace-pre-wrap">{l.body}</p>
                  <div className="mt-1 text-apple-xs text-apple-text-tertiary">
                    {new Date(l.createdAt).toLocaleString()}
                  </div>
                </div>
                <StatusBadge status={l.resolvedAt ? "RESOLVED" : l.kind} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
