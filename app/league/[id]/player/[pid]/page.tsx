import { notFound } from "next/navigation";
import { playerProfile, LeagueError } from "@/services/league.service";
import { Card, Divider, L, Pill, Scorecard, SectionTitle, Shell, Stat, money } from "@/components/league/ui";

export const dynamic = "force-dynamic";

export default async function PlayerPage({ params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  let p: Awaited<ReturnType<typeof playerProfile>>;
  try {
    p = await playerProfile(id, pid);
  } catch (e) {
    if (e instanceof LeagueError && e.status === 404) notFound();
    throw e;
  }
  const s = p.standing;
  return (
    <Shell title={p.player.name} subtitle={p.league.name} back={{ href: `/league/${id}`, label: "Leaderboard" }}>
      <Card tone="green">
        <div className="flex items-center gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: L.text3 }}>Season</div>
          {p.player.isMinor ? <Pill tone="blue">Under 18 · not money-eligible</Pill> : null}
          {s?.championshipQualified ? <Pill tone="green">Championship qualified</Pill> : null}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Stat label="Rank" value={s ? `#${s.rank}` : "—"} sub={`${s?.points ?? 0} pts`} />
          <Stat label="Handicap" value={s?.handicap ?? "—"} sub={s?.handicap == null ? "straight until a week closes" : "in force this week"} />
          <Stat label="Winnings" value={money(p.earningsCents)} />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Stat label="Straight pts" value={s?.grossPoints ?? 0} />
          <Stat label="Hcp pts" value={s?.netPoints ?? 0} />
          <Stat label="Team pts" value={s?.teamPoints ?? 0} />
        </div>
      </Card>

      <SectionTitle>Stats</SectionTitle>
      <Card>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Rounds" value={p.stats.rounds} />
          <Stat label="Avg gross" value={p.stats.avgGross ?? "—"} />
          <Stat label="Best gross" value={p.stats.bestGross ?? "—"} />
          <Stat label="Avg net" value={p.stats.avgNet ?? "—"} />
          <Stat label="Avg / hole" value={p.stats.avgPerHole ?? "—"} />
          <Stat label="Team W-L-T" value={`${p.stats.teamWins}-${p.stats.teamLosses}-${p.stats.teamTies}`} />
        </div>
      </Card>

      <SectionTitle>Scorecards</SectionTitle>
      {p.rounds.length === 0 ? (
        <Card><div className="text-sm" style={{ color: L.text2 }}>No rounds yet.</div></Card>
      ) : (
        <div className="space-y-3">
          {[...p.rounds].reverse().map((r) => (
            <Card key={r.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">Week {r.weekNumber}{r.courseName ? ` · ${r.courseName}` : ""}</div>
                  <div className="text-xs" style={{ color: L.text3 }}>
                    {new Date(r.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {r.source === "KIOSK" ? "bay kiosk" : r.source === "APP" ? "app" : "staff"}
                  </div>
                </div>
                {r.hidden ? (
                  <Pill tone="amber">Submitted</Pill>
                ) : (
                  <div className="text-right">
                    <div className="text-xl font-bold tabular-nums">{r.gross}</div>
                    <div className="text-xs" style={{ color: L.text2 }}>{r.net != null ? `net ${r.net} (hcp ${r.handicap})` : "straight"}</div>
                  </div>
                )}
              </div>
              {!r.hidden && r.holes ? (
                <>
                  <div className="my-3"><Scorecard holes={r.holes} /></div>
                  <div className="flex flex-wrap gap-2 text-xs" style={{ color: L.text2 }}>
                    <span>Straight #{r.grossRank ?? "—"}</span>
                    <span>·</span>
                    <span>Handicapped #{r.netRank ?? "—"}</span>
                    <span>·</span>
                    <span style={{ color: L.green }}>{r.points} pts</span>
                    {r.payoutCents ? <><span>·</span><span style={{ color: L.green }}>{money(r.payoutCents)}</span></> : null}
                  </div>
                </>
              ) : (
                <div className="mt-2 text-xs" style={{ color: L.text3 }}>Revealed after the Sunday deadline.</div>
              )}
            </Card>
          ))}
        </div>
      )}

      <SectionTitle>Teams</SectionTitle>
      <Card>
        {p.teams.length === 0 ? <div className="text-sm" style={{ color: L.text2 }}>No team assignments yet.</div> : null}
        {p.teams.map((t, i) => (
          <div key={t.weekNumber}>
            {i > 0 ? <Divider /> : null}
            <div className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="mr-2 text-xs" style={{ color: L.text3 }}>Wk {t.weekNumber}</span>
                {t.partner ? <>with <span className="font-medium">{t.partner}</span></> : <span style={{ color: L.text2 }}>solo</span>}
              </div>
              <span className="text-xs font-semibold" style={{ color: t.won ? L.green : t.won === false ? L.red : L.text3 }}>
                {t.won ? "Won" : t.won === false ? "Lost" : t.outcome === "TIE" ? "Tie" : t.outcome === "BYE" ? "Bye" : "Pending"}
              </span>
            </div>
          </div>
        ))}
      </Card>

      {p.payouts.length ? (
        <>
          <SectionTitle>Winnings</SectionTitle>
          <Card>
            {p.payouts.map((x) => (
              <div key={x.id} className="flex items-center justify-between py-1.5 text-sm">
                <span>{x.note ?? x.kind}{x.paidAt ? <span className="ml-2 text-xs" style={{ color: L.text3 }}>paid</span> : null}</span>
                <span className="font-semibold" style={{ color: L.green }}>{money(x.amountCents)}</span>
              </div>
            ))}
          </Card>
        </>
      ) : null}
    </Shell>
  );
}
