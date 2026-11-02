import { notFound } from "next/navigation";
import { leagueHub, LeagueError } from "@/services/league.service";
import { Shell } from "@/components/league/ui";
import { RulesBody } from "@/components/league/rules";

export const dynamic = "force-dynamic";

export default async function RulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let hub: Awaited<ReturnType<typeof leagueHub>>;
  try {
    hub = await leagueHub(id);
  } catch (e) {
    if (e instanceof LeagueError && e.status === 404) notFound();
    throw e;
  }
  return (
    <Shell title="League rules" subtitle={hub.league.name} back={{ href: `/league/${id}`, label: "League" }}>
      <RulesBody s={hub.league.settings} championshipAt={hub.league.championshipAt} leagueName={hub.league.name} />
    </Shell>
  );
}
