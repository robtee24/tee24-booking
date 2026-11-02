import Link from "next/link";
import { notFound } from "next/navigation";
import { leagueHub, LeagueError, type WeekView } from "@/services/league.service";
import { Card, Divider, L, Pill, RankBadge, Row, SectionTitle, Shell, Stat, money } from "@/components/league/ui";
import { GameSettings } from "@/components/league/rules";

export const dynamic = "force-dynamic";

export default async function LeaguePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; week?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  let hub: Awaited<ReturnType<typeof leagueHub>>;
  try {
    hub = await leagueHub(id);
  } catch (e) {
    if (e instanceof LeagueError && e.status === 404) notFound();
    throw e;
  }
  const tab = sp.tab === "weeks" || sp.tab === "settings" ? sp.tab : "standings";
  const cur = hub.weeks.find((w) => w.id === hub.currentWeek) ?? null;
  const selectedWeek = hub.weeks.find((w) => w.id === sp.week) ?? hub.weeks.filter((w) => w.status !== "UPCOMING").at(-1) ?? hub.weeks[0] ?? null;
  const tabs: { key: string; label: string }[] = [
    { key: "standings", label: "Leaderboard" },
    { key: "weeks", label: "Weeks & Teams" },
    { key: "settings", label: "Settings & Rules" },
  ];
  return (
    <Shell title={hub.league.name} subtitle={`${hub.league.location.name} · ${hub.standings.length} players`} back={{ href: "/league", label: "Leagues" }}>
      {cur ? (
        <Card tone={cur.status === "OPEN" ? "green" : undefined}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: L.text3 }}>{cur.status === "OPEN" ? "This week" : "Next up"}</div>
              <div className="mt-0.5 text-xl font-semibold">Week {cur.weekNumber}{cur.courseName ? ` · ${cur.courseName}` : ""}</div>
              <div className="text-sm" style={{ color: L.text2 }}>Deadline {cur.deadlineLabel}</div>
            </div>
            <Pill tone={cur.status === "OPEN" ? "green" : "neutral"}>{cur.status === "OPEN" ? "Open" : "Upcoming"}</Pill>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat label="Pot" value={money(cur.potCents)} />
            <Stat label="Submitted" value={cur.submittedCount} sub="scores hidden" />
            <Stat label="Champ. pot" value={money(hub.league.championshipPotCents)} />
          </div>
        </Card>
      ) : null}

      <div className="mt-4 flex gap-1 rounded-full p-1" style={{ background: L.surface }}>
        {tabs.map((t) => (
          <Link key={t.key} href={`/league/${id}?tab=${t.key}`} className="flex-1 rounded-full py-2 text-center text-sm font-medium" style={tab === t.key ? { background: L.surface2, color: L.text } : { color: L.text2 }}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "standings" ? <Standings hub={hub} id={id} /> : null}
      {tab === "weeks" ? <Weeks hub={hub} id={id} selected={selectedWeek} /> : null}
      {tab === "settings" ? (
        <>
          <SectionTitle right={<Link href={`/league/${id}/rules`} className="text-xs font-semibold" style={{ color: L.green }}>Full rules →</Link>}>League Settings</SectionTitle>
          <GameSettings s={hub.league.settings} />
          <SectionTitle>Entry & payouts</SectionTitle>
          <Card>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Weekly entry" value={money(hub.league.weeklyFeeCents)} sub={`Under ${hub.league.settings.minorAge} free`} />
              <Stat label="Championship" value={hub.league.championshipAt ? new Date(hub.league.championshipAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "TBD"} sub={`Top ${hub.league.championshipTopPct}% qualify`} />
              <Stat label="1st place" value={`${hub.league.settings.firstPlacePct}%`} sub={`up to ${money(hub.league.settings.firstPlaceCapCents)}`} />
              <Stat label="2nd place" value={`${hub.league.settings.secondPlacePct}%`} sub={`up to ${money(hub.league.settings.secondPlaceCapCents)}`} />
            </div>
          </Card>
        </>
      ) : null}
    </Shell>
  );
}

function Standings({ hub, id }: { hub: Awaited<ReturnType<typeof leagueHub>>; id: string }) {
  const cutoff = hub.standings.filter((s) => s.championshipQualified).length;
  return (
    <>
      <SectionTitle right={<span className="text-xs" style={{ color: L.text3 }}>Top {cutoff} qualify</span>}>Points leaderboard</SectionTitle>
      <Card>
        {hub.standings.length === 0 ? <div className="text-sm" style={{ color: L.text2 }}>No players yet.</div> : null}
        {hub.standings.map((s, i) => (
          <div key={s.playerId}>
            {i > 0 ? <Divider /> : null}
            <Row href={`/league/${id}/player/${s.playerId}`}>
              <RankBadge rank={s.rank} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{s.name}</span>
                  {s.isMinor ? <Pill tone="blue">U18</Pill> : null}
                  {s.championshipQualified ? <Pill tone="green">Champ.</Pill> : null}
                </div>
                <div className="text-xs" style={{ color: L.text3 }}>
                  {s.rounds} rounds · hcp {s.handicap ?? "—"} · straight {s.grossPoints} · hcp {s.netPoints} · team {s.teamPoints}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold tabular-nums">{s.points}</div>
                <div className="text-[11px]" style={{ color: s.earningsCents ? L.green : L.text3 }}>{money(s.earningsCents)}</div>
              </div>
            </Row>
          </div>
        ))}
      </Card>
    </>
  );
}

function Weeks({ hub, id, selected }: { hub: Awaited<ReturnType<typeof leagueHub>>; id: string; selected: WeekView | null }) {
  return (
    <>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {hub.weeks.map((w) => (
          <Link key={w.id} href={`/league/${id}?tab=weeks&week=${w.id}`} className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium" style={selected?.id === w.id ? { background: L.green, color: "#07110A" } : { background: L.surface, color: w.status === "UPCOMING" ? L.text3 : L.text2 }}>
            {w.isChampionship ? "Champ." : `Wk ${w.weekNumber}`}
          </Link>
        ))}
      </div>
      {selected ? (
        <>
          <Card className="mt-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Week {selected.weekNumber}{selected.courseName ? ` · ${selected.courseName}` : ""}</div>
                <div className="text-xs" style={{ color: L.text2 }}>Deadline {selected.deadlineLabel}</div>
              </div>
              <Pill tone={selected.status === "FINAL" ? "neutral" : selected.status === "OPEN" ? "green" : "amber"}>{selected.status === "FINAL" ? "Final" : selected.status === "OPEN" ? "Open" : selected.status === "CLOSED" ? "Closing…" : "Upcoming"}</Pill>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Stat label="Pot" value={money(selected.potCents)} />
              <Stat label="Scores" value={selected.submittedCount} />
              <Stat label="To champ." value={money(selected.toChampionshipCents)} />
            </div>
          </Card>

          <SectionTitle>Teams</SectionTitle>
          <Card>
            {selected.teams.length === 0 ? <div className="text-sm" style={{ color: L.text2 }}>Teams are drawn when the previous week closes.</div> : null}
            {selected.teams.map((t, i) => (
              <div key={t.teamNumber}>
                {i > 0 ? <Divider /> : null}
                <Row>
                  <div className="w-8 text-xs font-semibold" style={{ color: L.text3 }}>T{t.teamNumber}</div>
                  <div className="min-w-0 flex-1 text-sm">
                    {t.players.map((p, j) => (
                      <span key={p.playerId}>
                        {j > 0 ? <span style={{ color: L.text3 }}> & </span> : null}
                        <Link href={`/league/${id}/player/${p.playerId}`} className="font-medium hover:underline">{p.name}</Link>
                      </span>
                    ))}
                    <div className="text-xs" style={{ color: L.text3 }}>{t.opponentTeamNumber ? `vs T${t.opponentTeamNumber}` : "Bye"}</div>
                  </div>
                  {selected.revealed ? (
                    <div className="text-right">
                      <div className="text-sm font-semibold tabular-nums">{t.outcome === "BYE" ? "Bye" : t.outcome === "NOT_PLAYED" ? "—" : `${t.holesFor}–${t.holesAgainst}`}</div>
                      <div className="text-[11px]" style={{ color: t.won ? L.green : t.won === false ? L.red : L.text3 }}>{t.won ? "Won" : t.won === false ? "Lost" : t.outcome === "TIE" ? "Tie" : ""}</div>
                    </div>
                  ) : null}
                </Row>
              </div>
            ))}
          </Card>

          <SectionTitle>Results</SectionTitle>
          <Card>
            {!selected.revealed ? (
              <div className="text-sm" style={{ color: L.text2 }}>
                {selected.submittedCount} score{selected.submittedCount === 1 ? "" : "s"} submitted. Results are revealed {selected.deadlineLabel}.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-[1fr_3rem_3rem_3rem_3rem] gap-2 pb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: L.text3 }}>
                  <div>Player</div><div className="text-right">Gross</div><div className="text-right">Hcp</div><div className="text-right">Net</div><div className="text-right">Pts</div>
                </div>
                {(selected.results ?? []).map((r) => (
                  <Link key={r.playerId} href={`/league/${id}/player/${r.playerId}`} className="grid grid-cols-[1fr_3rem_3rem_3rem_3rem] gap-2 border-t py-2 text-sm tabular-nums" style={{ borderColor: L.border }}>
                    <div className="truncate">
                      <span className="mr-1.5 text-xs" style={{ color: L.text3 }}>{r.grossRank}</span>{r.name}
                      {r.payoutCents ? <span className="ml-2 text-xs font-semibold" style={{ color: L.green }}>{money(r.payoutCents)}</span> : null}
                    </div>
                    <div className="text-right font-semibold">{r.gross}</div>
                    <div className="text-right" style={{ color: L.text2 }}>{r.handicap ?? "—"}</div>
                    <div className="text-right">{r.net ?? "—"}</div>
                    <div className="text-right font-bold" style={{ color: r.points ? L.green : L.text3 }}>{r.points}</div>
                  </Link>
                ))}
              </>
            )}
          </Card>
          {selected.payouts.length ? (
            <>
              <SectionTitle>Payouts</SectionTitle>
              <Card>
                {selected.payouts.map((p, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 text-sm">
                    <span>{p.name} <span className="text-xs" style={{ color: L.text3 }}>· {label(p.kind)}</span></span>
                    <span className="font-semibold" style={{ color: L.green }}>{money(p.amountCents)}</span>
                  </div>
                ))}
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function label(kind: string) {
  return ({ GROSS_1: "1st straight", GROSS_2: "2nd straight", NET_1: "1st handicapped", NET_2: "2nd handicapped", TEAM_1: "Team of the week", TEAM_2: "2nd team", CHAMPIONSHIP: "Championship", ADJUSTMENT: "Adjustment" } as Record<string, string>)[kind] ?? kind;
}
