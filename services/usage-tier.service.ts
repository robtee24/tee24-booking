/**
 * Nightly job: compute UsageTierSnapshot for every active member, by cohort.
 *
 * Cohorts are coarse (plan name + tenure bucket). For each cohort we compute the
 * 30th and 70th percentile of visits90d and use those to bucket each member.
 *
 * Deltas (e.g. ABOVE_AVG → LIGHT) emit AT_RISK detection downstream.
 */
import { getPrisma } from "@/lib/db";
import { classifyUsageTier, type UsageTier } from "./attendance.service";

export async function computeUsageTierSnapshots(now = new Date()) {
  const prisma = getPrisma();
  const cutoff90 = new Date(now.getTime() - 90 * 86_400_000);
  const cutoff30 = new Date(now.getTime() - 30 * 86_400_000);

  const members = await prisma.member.findMany({
    where: { status: { in: ["ACTIVE", "FROZEN"] } },
    select: {
      id: true,
      joinDate: true,
      membershipType: true,
    },
  });

  // Bucket by (membershipType, tenureBucket)
  const cohortMap = new Map<string, Array<{ id: string; visits90d: number; visits30d: number }>>();
  const memberStats: Array<{ id: string; cohortKey: string; visits90d: number; visits30d: number }> = [];

  for (const m of members) {
    const visits = await prisma.visit.findMany({
      where: { memberId: m.id, enteredAt: { gte: cutoff90 } },
      select: { enteredAt: true },
    });
    const visits90d = visits.length;
    const visits30d = visits.filter((v) => v.enteredAt >= cutoff30).length;
    const tenureBucket = bucketTenure(m.joinDate);
    const cohortKey = `${m.membershipType ?? "_unknown"}::${tenureBucket}`;
    const list = cohortMap.get(cohortKey) ?? [];
    list.push({ id: m.id, visits90d, visits30d });
    cohortMap.set(cohortKey, list);
    memberStats.push({ id: m.id, cohortKey, visits90d, visits30d });
  }

  // Compute cohort percentiles
  const cohortPctiles = new Map<string, { p30: number; p70: number }>();
  for (const [key, rows] of cohortMap.entries()) {
    const sorted = rows.map((r) => r.visits90d).sort((a, b) => a - b);
    cohortPctiles.set(key, {
      p30: percentile(sorted, 0.3),
      p70: percentile(sorted, 0.7),
    });
  }

  // Get prior tier for each member
  const priorByMember = new Map<string, UsageTier | undefined>();
  const priors = await prisma.usageTierSnapshot.findMany({
    orderBy: { computedAt: "desc" },
    take: members.length, // approximate; we'll only use latest per member
    select: { memberId: true, tier: true },
  });
  for (const p of priors) {
    if (!priorByMember.has(p.memberId)) priorByMember.set(p.memberId, p.tier as UsageTier);
  }

  // Write new snapshots
  let written = 0;
  for (const stat of memberStats) {
    const pcts = cohortPctiles.get(stat.cohortKey)!;
    const tier = classifyUsageTier({
      visits30d: stat.visits30d,
      visits90d: stat.visits90d,
      cohortP30Visits90d: pcts.p30,
      cohortP70Visits90d: pcts.p70,
      prevTier: priorByMember.get(stat.id),
    });
    const cohortPercentile =
      pcts.p70 > 0 ? Math.min(100, (stat.visits90d / pcts.p70) * 70) : 0;

    await prisma.usageTierSnapshot.create({
      data: {
        memberId: stat.id,
        tier,
        visits30d: stat.visits30d,
        visits90d: stat.visits90d,
        cohortPercentile,
      },
    });
    written++;
  }

  return { members: members.length, snapshots: written };
}

function bucketTenure(joinDate: Date | null): string {
  if (!joinDate) return "unknown";
  const months = (Date.now() - joinDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (months < 3) return "new";
  if (months < 12) return "year1";
  if (months < 36) return "year1-3";
  return "loyal";
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[i];
}
