import { getCurrentAdmin, isFullAccess } from "@/lib/access";
import { getPrisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { listLeagues } from "@/services/league.service";
import { LeagueListClient } from "./LeagueListClient";

export const dynamic = "force-dynamic";

export default async function LeagueAdminPage() {
  const admin = await getCurrentAdmin();
  if (!admin) return null;
  const full = isFullAccess(admin.role);
  const locationIds = full ? null : admin.locations.map((l) => l.locationId);
  const [leagues, locations] = await Promise.all([
    listLeagues(locationIds),
    getPrisma().location.findMany({ where: locationIds ? { id: { in: locationIds } } : {}, select: { id: true, name: true, slug: true, timezone: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="League Manager" description="One league for all Tee24 locations: weekly scores, entries, handicaps, teams, points and payouts. Members join from the app or kiosk and submit scores at the bay kiosk." />
      <LeagueListClient
        leagues={leagues.map((l) => ({
          id: l.id,
          name: l.name,
          status: l.status,
          location: l.location.name,
          playerCount: l.playerCount,
          weeks: l.weeks.length,
          championshipPotCents: l.championshipPotCents,
          currentWeek: l.currentWeek ? { weekNumber: l.currentWeek.weekNumber, courseName: l.currentWeek.courseName, deadlineAt: l.currentWeek.deadlineAt.toISOString(), potCents: l.currentWeek.potCents } : null,
        }))}
        locations={locations}
      />
    </div>
  );
}
