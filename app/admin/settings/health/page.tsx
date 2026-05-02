import { getPrisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { Activity } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const prisma = getPrisma();

  const [recent, drift] = await Promise.all([
    prisma.webhookDelivery.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.webhookDelivery.groupBy({
      by: ["provider", "status"],
      _count: { _all: true },
    }).catch(() => [] as any[]),
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
