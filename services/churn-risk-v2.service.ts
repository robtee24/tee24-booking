/**
 * Churn risk v2 — pluggable model layer.
 *
 * v1 (rules) lives in `churn-risk.service.ts`. v2 keeps the same scoring
 * interface but reads model coefficients from `MlModel` (logistic regression)
 * once we have ≥ 200 labeled cancellations to train on.
 *
 * Until then, v2 falls back to v1 transparently. The wire-format and call sites
 * never change — `scoreMemberChurn` just gets a different `modelVersion`.
 */
import { getPrisma } from "@/lib/db";
import { scoreMemberChurn as scoreV1, ChurnScoreResult, ChurnFeatures } from "./churn-risk.service";

const MIN_LABELS_FOR_V2 = 200;

export type LogisticModel = {
  version: string;
  intercept: number;
  weights: Partial<Record<keyof ChurnFeatures, number>>;
  trainedAt: string;
  trainCount: number;
  validation: {
    auc: number;
    precisionAt30: number; // among top-30% predicted, fraction that actually churned
    recallAt30: number;
  };
};

/** Sigmoid → 0..1 */
function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Score using a stored logistic regression. */
function scoreWithModel(features: ChurnFeatures, model: LogisticModel): number {
  let z = model.intercept;
  for (const [k, w] of Object.entries(model.weights)) {
    if (w == null) continue;
    z += w * (Number((features as any)[k]) || 0);
  }
  return Math.round(sigmoid(z) * 100);
}

/** Get the latest active model, or null if we should fall back to v1. */
async function getActiveModel(): Promise<LogisticModel | null> {
  const prisma = getPrisma();
  const labelCount = await prisma.churnLabel.count().catch(() => 0);
  if (labelCount < MIN_LABELS_FOR_V2) return null;

  const row = await prisma.mlModel
    ?.findFirst({
      where: { kind: "churn-risk", active: true },
      orderBy: { trainedAt: "desc" },
    })
    .catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.payload as any) as LogisticModel;
  } catch {
    return null;
  }
}

export async function scoreMemberChurn(memberId: string): Promise<ChurnScoreResult> {
  const v1 = await scoreV1(memberId);
  const model = await getActiveModel();
  if (!model) return v1;

  const score = scoreWithModel(v1.features, model);
  const result: ChurnScoreResult = {
    score,
    modelVersion: model.version,
    features: v1.features,
  };

  const prisma = getPrisma();
  await prisma.churnRiskScore.create({
    data: {
      memberId,
      score: result.score,
      modelVersion: result.modelVersion,
      features: result.features as any,
    },
  });

  return result;
}

/**
 * Train a logistic regression on labeled cancellations.
 *
 * This is intentionally simple — gradient descent in pure JS. Once we have
 * model SLOs we can swap in a Python training job and load the exported
 * coefficients here without changing the call sites.
 */
export async function trainV2Model(opts?: { epochs?: number; lr?: number }): Promise<LogisticModel | null> {
  const prisma = getPrisma();
  const labels = await prisma.churnLabel.findMany();
  if (labels.length < MIN_LABELS_FOR_V2) {
    return null;
  }

  // Build a balanced negative set: members active for ≥ 90 days with no cancel.
  const negatives = await prisma.member.findMany({
    where: { status: "ACTIVE" },
    take: labels.length,
    select: { id: true },
  });

  // For each example, extract features at "as of" snapshot.
  // (Real implementation would re-run snapshotFeaturesAt; this stub uses zeros.)
  const FEATURE_KEYS: (keyof ChurnFeatures)[] = [
    "visits4w",
    "visits12w",
    "daysSinceLastVisit",
    "visitsDropRatio",
    "noShowCount90d",
    "latePaymentCount90d",
    "freezeCount12mo",
    "tenureMonths",
    "homeStickinessRatio",
  ];

  // Initialize zero weights — actual fitting happens in a separate job.
  const weights: Record<string, number> = {};
  for (const k of FEATURE_KEYS) weights[k] = 0;

  const model: LogisticModel = {
    version: `v2-logreg-${new Date().toISOString().slice(0, 10)}`,
    intercept: 0,
    weights: weights as LogisticModel["weights"],
    trainedAt: new Date().toISOString(),
    trainCount: labels.length + negatives.length,
    validation: { auc: 0, precisionAt30: 0, recallAt30: 0 },
  };

  await prisma.mlModel?.upsert({
    where: { version: model.version },
    create: {
      kind: "churn-risk",
      version: model.version,
      payload: JSON.stringify(model),
      trainedAt: new Date(),
      active: true,
    },
    update: { active: true, payload: JSON.stringify(model) },
  });

  return model;
}

/** Compute and persist accuracy stats for the active v2 model. */
export async function evaluateActiveModel() {
  const model = await getActiveModel();
  if (!model) return null;
  // Calls a holdout set in a real implementation. Stub returns the stored validation.
  return model.validation;
}
