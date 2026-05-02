/**
 * Churn risk score (v1: rules-based).
 *
 * Score = weighted sum of normalized features, clipped to 0-100.
 * Higher = higher risk of cancellation in the next 30 days.
 *
 * v2 (Phase 5) swaps in a logistic regression / gradient-boosted model trained
 * on labeled cancellation history (`ChurnLabel` table). Same scoring API surface.
 */
import { getPrisma } from "@/lib/db";

export type ChurnFeatures = {
  visits4w: number;
  visits12w: number;
  daysSinceLastVisit: number;
  visitsDropRatio: number; // visits4w/(visits12w-visits4w) clipped
  noShowCount90d: number;
  latePaymentCount90d: number;
  freezeCount12mo: number;
  tenureMonths: number;
  homeStickinessRatio: number; // visits at home / total visits
};

export type ChurnScoreResult = {
  score: number; // 0..100
  modelVersion: string;
  features: ChurnFeatures;
};

const WEIGHTS = {
  daysSinceLastVisit: 1.5,    // 0-60+ → score
  visitsDropRatio: 25,        // 0..2
  noShowCount90d: 8,
  latePaymentCount90d: 12,
  freezeCount12mo: 6,
  // Negative weights = protective
  visits4wPositive: -2.5,
  tenurePositive: -0.4,       // months
  homeStickinessPositive: -8, // 0..1
};

export async function scoreMemberChurn(memberId: string): Promise<ChurnScoreResult> {
  const prisma = getPrisma();
  const now = new Date();
  const c4w = new Date(now.getTime() - 28 * 86_400_000);
  const c12w = new Date(now.getTime() - 84 * 86_400_000);
  const c12mo = new Date(now.getTime() - 365 * 86_400_000);

  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) throw new Error("Member not found");

  const [visits4wList, visits12wList, freezeRows, latePayments] = await Promise.all([
    prisma.visit.findMany({
      where: { memberId, enteredAt: { gte: c4w } },
      select: { enteredAt: true, locationId: true },
    }),
    prisma.visit.findMany({
      where: { memberId, enteredAt: { gte: c12w } },
      select: { enteredAt: true, locationId: true },
    }),
    prisma.membershipSubscription.findMany({
      where: { memberId, freezeStartDate: { gte: c12mo, not: null } },
      select: { id: true },
    }),
    prisma.invoice.findMany({
      where: {
        memberId,
        status: { in: ["PAST_DUE", "FAILED"] },
        dueDate: { gte: new Date(now.getTime() - 90 * 86_400_000) },
      },
      select: { id: true },
    }),
  ]);

  const visits4w = visits4wList.length;
  const visits12w = visits12wList.length;
  const lastVisit = visits12wList.sort((a, b) => b.enteredAt.getTime() - a.enteredAt.getTime())[0];
  const daysSinceLastVisit = lastVisit
    ? Math.floor((now.getTime() - lastVisit.enteredAt.getTime()) / 86_400_000)
    : 90;
  const baseline4w = Math.max(0.5, (visits12w - visits4w) / 2);
  const visitsDropRatio = Math.max(0, Math.min(2, baseline4w === 0 ? 0 : 1 - visits4w / baseline4w));

  const homeVisits = visits12wList.filter((v) => v.locationId === (member.homeLocationId ?? member.locationId)).length;
  const homeStickinessRatio = visits12wList.length > 0 ? homeVisits / visits12wList.length : 0.5;

  const tenureMonths = member.joinDate
    ? Math.max(0, (now.getTime() - member.joinDate.getTime()) / (1000 * 60 * 60 * 24 * 30))
    : 0;

  // No-shows: bookings that overlap a window with no Kisi visit
  // (lightweight v1: take canceledAt-null bookings without checkedInAt as proxy)
  const noShows = await prisma.booking.count({
    where: {
      memberId,
      canceledAt: null,
      checkedInAt: null,
      end: { lt: now, gte: c12w },
    },
  });

  const features: ChurnFeatures = {
    visits4w,
    visits12w,
    daysSinceLastVisit,
    visitsDropRatio,
    noShowCount90d: noShows,
    latePaymentCount90d: latePayments.length,
    freezeCount12mo: freezeRows.length,
    tenureMonths,
    homeStickinessRatio,
  };

  let raw =
    WEIGHTS.daysSinceLastVisit * Math.min(60, daysSinceLastVisit) +
    WEIGHTS.visitsDropRatio * visitsDropRatio +
    WEIGHTS.noShowCount90d * noShows +
    WEIGHTS.latePaymentCount90d * latePayments.length +
    WEIGHTS.freezeCount12mo * freezeRows.length +
    WEIGHTS.visits4wPositive * visits4w +
    WEIGHTS.tenurePositive * tenureMonths +
    WEIGHTS.homeStickinessPositive * homeStickinessRatio;

  const score = Math.max(0, Math.min(100, Math.round(raw)));

  const result: ChurnScoreResult = {
    score,
    modelVersion: "v1-rules",
    features,
  };

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

export async function captureChurnLabel(opts: { memberId: string; cancelledAt: Date; reason?: string }) {
  const prisma = getPrisma();
  const now = opts.cancelledAt;
  const f30 = await snapshotFeaturesAt(opts.memberId, new Date(now.getTime() - 30 * 86_400_000));
  const f60 = await snapshotFeaturesAt(opts.memberId, new Date(now.getTime() - 60 * 86_400_000));
  const f90 = await snapshotFeaturesAt(opts.memberId, new Date(now.getTime() - 90 * 86_400_000));

  return prisma.churnLabel.create({
    data: {
      memberId: opts.memberId,
      cancelledAt: now,
      reason: opts.reason ?? null,
      features30d: f30 as any,
      features60d: f60 as any,
      features90d: f90 as any,
    },
  });
}

async function snapshotFeaturesAt(memberId: string, asOf: Date) {
  const prisma = getPrisma();
  const c4w = new Date(asOf.getTime() - 28 * 86_400_000);
  const visits = await prisma.visit.count({
    where: { memberId, enteredAt: { gte: c4w, lte: asOf } },
  });
  return { asOf: asOf.toISOString(), visits4wAtSnap: visits };
}

/**
 * Run scoring across all active members. Cron: daily.
 */
export async function scoreAllMembers() {
  const prisma = getPrisma();
  const members = await prisma.member.findMany({
    where: { status: { in: ["ACTIVE", "FROZEN"] } },
    select: { id: true },
  });
  let scored = 0;
  for (const m of members) {
    try {
      await scoreMemberChurn(m.id);
      scored++;
    } catch (e) {
      console.warn("[churn] scoring failed for", m.id, e);
    }
  }
  return scored;
}
