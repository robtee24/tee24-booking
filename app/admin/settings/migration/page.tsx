/**
 * Migration runbook + status. Read-only dashboard for the parallel-sync window
 * and the post-cutover hyper-care period.
 */
import { getPrisma } from "@/lib/db";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function MigrationPage() {
  const prisma = getPrisma();
  const [members, withGymdesk, recentImports] = await Promise.all([
    prisma.member.count(),
    prisma.member.count({ where: { gymDeskId: { not: null } } }),
    prisma.auditLog
      .findMany({
        where: { entityType: "Migration" },
        orderBy: { createdAt: "desc" },
        take: 10,
      })
      .catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Migration"
        description="Gymdesk → Tee24 cutover runbook"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <div className="text-apple-sm text-apple-text-secondary">Total members</div>
          <div className="mt-1 text-apple-2xl font-semibold">{members.toLocaleString()}</div>
        </Card>
        <Card>
          <div className="text-apple-sm text-apple-text-secondary">Migrated from Gymdesk</div>
          <div className="mt-1 text-apple-2xl font-semibold">{withGymdesk.toLocaleString()}</div>
          <div className="mt-1 text-apple-xs text-apple-text-secondary">
            {members > 0 ? `${Math.round((withGymdesk / members) * 100)}% of total` : "—"}
          </div>
        </Card>
        <Card>
          <div className="text-apple-sm text-apple-text-secondary">Recent import jobs</div>
          <div className="mt-1 text-apple-2xl font-semibold">{String(recentImports.length)}</div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Cutover checklist" />
        <CardBody>
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li>Pull final Gymdesk export.</li>
            <li>Run <code>npm run migration:dry-run</code> &amp; review the report.</li>
            <li>Freeze writes in Gymdesk; redirect signup form DNS.</li>
            <li>Run <code>npm run migration:cutover</code>.</li>
            <li>Begin 2-week hyper-care window.</li>
            <li>Decommission Gymdesk.</li>
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recent import jobs" />
        <CardBody>
          {recentImports.length === 0 ? (
            <p className="text-sm text-neutral-500">No migration runs yet.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {recentImports.map((row: any) => (
                <li key={row.id}>
                  <span className="text-neutral-500">{new Date(row.createdAt).toLocaleString()}</span>{" "}
                  — {row.action}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
