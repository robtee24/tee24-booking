import { getPrisma } from "@/lib/db";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { History } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) return null;
  const sp = await searchParams;
  const action = sp.action;
  const entityType = sp.entityType;
  const actorId = sp.actorId;

  const where: any = {};
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;
  if (actorId) where.actorId = actorId;

  const entries = await getPrisma().auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actor: { select: { name: true, phone: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Every sensitive action across billing, members, integrations, and settings."
      />

      <Card padded={false}>
        {entries.length === 0 ? (
          <EmptyState icon={<History className="h-6 w-6" />} title="Nothing logged yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-apple-sm">
              <thead className="border-b border-apple-divider bg-apple-fill-secondary text-apple-xs uppercase text-apple-text-tertiary">
                <tr>
                  <th className="px-4 py-3 text-left">Time</th>
                  <th className="px-4 py-3 text-left">Actor</th>
                  <th className="px-4 py-3 text-left">Action</th>
                  <th className="px-4 py-3 text-left">Entity</th>
                  <th className="px-4 py-3 text-left">Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-apple-divider align-top last:border-b-0">
                    <td className="px-4 py-3 text-apple-text-tertiary whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">{e.actor?.name ?? e.actor?.phone ?? "system"}</td>
                    <td className="px-4 py-3"><StatusBadge status={e.action} size="sm" /></td>
                    <td className="px-4 py-3 text-apple-text-secondary">{e.entityType} <span className="text-apple-xs text-apple-text-tertiary">{e.entityId.slice(0, 8)}</span></td>
                    <td className="px-4 py-3 max-w-md text-apple-xs text-apple-text-secondary">
                      {e.metadata && (
                        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-apple-fill-secondary p-2">{JSON.stringify(e.metadata)}</pre>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {!isFullAccess(admin.role) && (
        <p className="text-apple-xs text-apple-text-tertiary">Note: scoped admins see only entries within their assigned locations.</p>
      )}
    </div>
  );
}
