import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { Activity } from "lucide-react";
import { requireFullAccessPage } from "../_full-only";

export const dynamic = "force-dynamic";

type DbSecurity = { ok: boolean; role: string | null; bypassRls: boolean; total: number; protected: number; unprotected: string[] };

/** Who are we connected as, and is every public table behind RLS with the app policy? */
async function databaseSecurityCheck(prisma: ReturnType<typeof getPrisma>): Promise<DbSecurity> {
  try {
    const [[who], rows] = await Promise.all([
      prisma.$queryRaw<Array<{ role: string; bypassrls: boolean }>>`select current_user::text as role, (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls`,
      prisma.$queryRaw<Array<{ table: string; rls: boolean; policy: boolean }>>`
        select c.relname::text as "table", c.relrowsecurity as rls,
               exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'tee24_app_all') as policy
        from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> '_prisma_migrations'
        order by c.relname`,
    ]);
    const unprotected = rows.filter((r) => !r.rls || !r.policy).map((r) => r.table);
    return { ok: who.role === "tee24_app" && unprotected.length === 0, role: who.role, bypassRls: who.bypassrls, total: rows.length, protected: rows.length - unprotected.length, unprotected };
  } catch {
    return { ok: false, role: null, bypassRls: false, total: 0, protected: 0, unprotected: [] };
  }
}

export default async function HealthPage() {
  const denied = await requireFullAccessPage("Integration health");
  if (denied) return denied;
  const prisma = getPrisma();

  const [recent, drift, dbSecurity] = await Promise.all([
    prisma.webhookDelivery.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.webhookDelivery.groupBy({
      by: ["provider", "status"],
      _count: { _all: true },
    }).catch(() => [] as any[]),
    databaseSecurityCheck(prisma),
  ]);

  const providers = ["SQUARE", "KISI", "QUO", "RESEND", "PAYPAL"] as const;

  function summarize(provider: string) {
    const rows = (drift as any[]).filter((r) => r.provider === provider);
    const total = rows.reduce((s, r) => s + (r._count?._all ?? 0), 0);
    const failed = rows.filter((r) => r.status === "FAILED" || r.status === "RETRYING").reduce((s, r) => s + (r._count?._all ?? 0), 0);
    return { total, failed };
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Integration health" description="Webhook delivery, retries, and drift across external systems." />

      <Card>
        <CardHeader
          title="Database security"
          subtitle="The app should connect as the least-privilege role and every table should have row-level security with the tee24_app policy."
          action={<StatusBadge status={dbSecurity.ok ? "OK" : "ATTENTION"} size="sm" />}
        />
        <dl className="mt-3 grid grid-cols-1 gap-3 text-apple-sm sm:grid-cols-3">
          <div>
            <dt className="text-apple-text-tertiary">Runtime role</dt>
            <dd className={`font-mono ${dbSecurity.role === "tee24_app" ? "text-apple-text" : "text-apple-red"}`}>{dbSecurity.role ?? "unknown"}{dbSecurity.bypassRls ? " (bypasses RLS)" : ""}</dd>
          </div>
          <div>
            <dt className="text-apple-text-tertiary">Tables with RLS + policy</dt>
            <dd className="tabular-nums">{dbSecurity.protected} / {dbSecurity.total}</dd>
          </div>
          <div>
            <dt className="text-apple-text-tertiary">Unprotected tables</dt>
            <dd className={dbSecurity.unprotected.length ? "font-mono text-apple-red" : "text-apple-text-tertiary"}>{dbSecurity.unprotected.length ? dbSecurity.unprotected.join(", ") : "None"}</dd>
          </div>
        </dl>
        {dbSecurity.unprotected.length > 0 && (
          <p className="mt-3 text-apple-xs text-apple-text-tertiary">
            Add to the migration that created each table: <code className="rounded bg-apple-fill-secondary px-1 py-0.5 font-mono">ALTER TABLE &quot;X&quot; ENABLE ROW LEVEL SECURITY; CREATE POLICY tee24_app_all ON &quot;X&quot; FOR ALL TO tee24_app USING (true) WITH CHECK (true);</code>
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
        {providers.map((p) => {
          const s = summarize(p);
          const ok = s.failed === 0;
          return (
            <Card key={p}>
              <div className="text-apple-xs uppercase text-apple-text-tertiary">{p}</div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-apple-2xl font-semibold tabular-nums">{s.total}</span>
                <StatusBadge status={ok ? "OK" : "ATTENTION"} size="sm" />
              </div>
              <div className="mt-1 text-apple-xs text-apple-text-tertiary">{s.failed} retrying / failed</div>
            </Card>
          );
        })}
      </div>

      <Card padded={false}>
        <CardHeader title="Recent deliveries" className="p-5" />
        {recent.length === 0 ? (
          <EmptyState icon={<Activity className="h-6 w-6" />} title="No webhooks yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-apple-sm">
              <thead className="border-b border-apple-divider bg-apple-fill-secondary text-apple-xs uppercase text-apple-text-tertiary">
                <tr>
                  <th className="px-4 py-3 text-left">Time</th>
                  <th className="px-4 py-3 text-left">Provider</th>
                  <th className="px-4 py-3 text-left">Event</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Attempts</th>
                  <th className="px-4 py-3 text-left">Last error</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((w) => (
                  <tr key={w.id} className="border-b border-apple-divider last:border-b-0">
                    <td className="px-4 py-3 text-apple-text-tertiary whitespace-nowrap">{new Date(w.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">{w.provider}</td>
                    <td className="px-4 py-3">{w.eventType}</td>
                    <td className="px-4 py-3"><StatusBadge status={w.status} size="sm" /></td>
                    <td className="px-4 py-3">{w.attempts}</td>
                    <td className="px-4 py-3 text-apple-xs text-apple-red">{w.lastError ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
