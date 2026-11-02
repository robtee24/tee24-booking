import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { currentWeekOf } from "@/services/league.service";
import { Card, L, Pill, Shell, money } from "@/components/league/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tee24 League" };

export default async function LeagueIndex() {
  const leagues = await getPrisma().league.findMany({
    where: { status: { in: ["OPEN", "ACTIVE", "COMPLETE"] } },
    include: { location: { select: { name: true } }, weeks: { orderBy: { weekNumber: "asc" } }, _count: { select: { players: { where: { active: true } } } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  const now = new Date();
  return (
    <Shell title="Tee24 League" subtitle="Winter league · straight, handicapped & team">
      {leagues.length === 0 ? (
        <Card>
          <div className="text-sm" style={{ color: L.text2 }}>No leagues are running right now. Check back soon.</div>
        </Card>
      ) : (
        <div className="space-y-3">
          {leagues.map((l) => {
            const w = currentWeekOf(l.weeks, now);
            return (
              <Link key={l.id} href={`/league/${l.id}`} className="block">
                <Card className="transition hover:border-[#34403A]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">{l.name}</div>
                      <div className="text-xs" style={{ color: L.text2 }}>{l.location.name} · {l._count.players} players</div>
                    </div>
                    <Pill tone={l.status === "COMPLETE" ? "neutral" : "green"}>{l.status === "COMPLETE" ? "Finished" : "Live"}</Pill>
                  </div>
                  {w ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" style={{ color: L.text2 }}>
                      <span>Week {w.weekNumber}{w.courseName ? ` · ${w.courseName}` : ""}</span>
                      <span>·</span>
                      <span>Pot {money(w.potCents)}</span>
                    </div>
                  ) : null}
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
