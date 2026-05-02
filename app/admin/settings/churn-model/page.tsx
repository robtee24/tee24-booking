/**
 * Churn risk model dashboard. Shows the active model version, recent training
 * runs, and validation metrics. v1 (rules) is the default; v2 (logistic
 * regression) auto-activates once we have ≥ 200 labeled cancellations.
 */
import { getPrisma } from "@/lib/db";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function ChurnModelPage() {
  const prisma = getPrisma();
  const [labelCount, models, lastScores] = await Promise.all([
    prisma.churnLabel.count(),
    prisma.mlModel.findMany({
      where: { kind: "churn-risk" },
      orderBy: { trainedAt: "desc" },
      take: 5,
    }),
    prisma.churnRiskScore.findMany({
      orderBy: { computedAt: "desc" },
      take: 1,
    }),
  ]);

  const active = models.find((m) => m.active);
  const activeModel = active ? safeJson(active.payload) : null;
  const minLabels = 200;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Churn risk model"
        description="Train, version, and monitor churn predictions."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <div className="text-apple-sm text-apple-text-secondary">Active model</div>
          <div className="mt-1 text-apple-2xl font-semibold">
            {active?.version ?? "v1-rules (fallback)"}
          </div>
          <div className="mt-1 text-apple-xs text-apple-text-secondary">
            {active ? `Trained ${new Date(active.trainedAt).toLocaleDateString()}` : "v2 not trained yet"}
          </div>
        </Card>

        <Card>
          <div className="text-apple-sm text-apple-text-secondary">Labels collected</div>
          <div className="mt-1 text-apple-2xl font-semibold">{labelCount.toLocaleString()}</div>
          <div className="mt-1 text-apple-xs text-apple-text-secondary">
            {labelCount >= minLabels
              ? "Ready for v2 training"
              : `Need ${minLabels - labelCount} more`}
          </div>
        </Card>

        <Card>
          <div className="text-apple-sm text-apple-text-secondary">Most recent score</div>
          <div className="mt-1 text-apple-2xl font-semibold">
            {lastScores[0] ? lastScores[0].score : "—"}
          </div>
          <div className="mt-1 text-apple-xs text-apple-text-secondary">
            {lastScores[0] ? new Date(lastScores[0].computedAt).toLocaleString() : "No scores yet"}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Validation metrics" />
        <CardBody>
          {!activeModel?.validation ? (
            <p className="text-sm text-neutral-500">
              No validation metrics yet. Train v2 once {minLabels} labels are collected to see AUC,
              precision@30%, and recall@30%.
            </p>
          ) : (
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-apple-text-secondary">AUC</dt>
                <dd className="text-apple-lg font-semibold">{activeModel.validation.auc?.toFixed(3) ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-apple-text-secondary">Precision @ top-30%</dt>
                <dd className="text-apple-lg font-semibold">
                  {(activeModel.validation.precisionAt30 * 100)?.toFixed(1) ?? "—"}%
                </dd>
              </div>
              <div>
                <dt className="text-apple-text-secondary">Recall @ top-30%</dt>
                <dd className="text-apple-lg font-semibold">
                  {(activeModel.validation.recallAt30 * 100)?.toFixed(1) ?? "—"}%
                </dd>
              </div>
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Training history" />
        <CardBody>
          {models.length === 0 ? (
            <p className="text-sm text-neutral-500">No models trained yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-apple-text-secondary">
                <tr>
                  <th className="py-1">Version</th>
                  <th>Trained</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id} className="border-t border-apple-divider">
                    <td className="py-2">{m.version}</td>
                    <td>{new Date(m.trainedAt).toLocaleString()}</td>
                    <td>{m.active ? "Yes" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
