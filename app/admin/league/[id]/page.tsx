import { notFound } from "next/navigation";
import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { getPrisma } from "@/lib/db";
import { adminLeagueDetail, LeagueError, leagueScopeForLocations } from "@/services/league.service";
import { LeagueDetailClient } from "./LeagueDetailClient";

export const dynamic = "force-dynamic";

export default async function LeagueDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ week?: string; tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const admin = await getCurrentAdmin();
  if (!admin) return null;
  const scope = isFullAccess(admin.role) ? {} : await leagueScopeForLocations(admin.locations.map((l) => l.locationId));
  const league = await getPrisma().league.findFirst({ where: { id, ...scope }, select: { id: true } });
  if (!league) notFound();
  let detail: Awaited<ReturnType<typeof adminLeagueDetail>>;
  try {
    detail = await adminLeagueDetail(id);
  } catch (e) {
    if (e instanceof LeagueError && e.status === 404) notFound();
    throw e;
  }
  return <LeagueDetailClient detail={JSON.parse(JSON.stringify(detail))} initialWeekId={sp.week ?? null} initialTab={sp.tab ?? null} />;
}
