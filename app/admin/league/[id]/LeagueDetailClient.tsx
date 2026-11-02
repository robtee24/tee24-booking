"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, Input, Modal, PageHeader, Select, Textarea, formatMoney, useToast } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import type { adminLeagueDetail } from "@/services/league.service";

type Detail = Awaited<ReturnType<typeof adminLeagueDetail>>;
type AdminWeek = Detail["adminWeeks"][number];
type WeekView = Detail["weeks"][number];

const TABS = ["weeks", "standings", "players", "settings", "money"] as const;
type Tab = (typeof TABS)[number];

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/league", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) throw new Error(j.error || "Request failed");
  return j;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function LeagueDetailClient({ detail, initialWeekId, initialTab }: { detail: Detail; initialWeekId: string | null; initialTab: string | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "weeks");
  const defaultWeek = detail.weeks.find((w) => w.id === initialWeekId) ?? detail.weeks.find((w) => w.id === detail.currentWeek) ?? detail.weeks.filter((w) => w.status !== "UPCOMING").at(-1) ?? detail.weeks[0] ?? null;
  const [weekId, setWeekId] = useState<string | null>(defaultWeek?.id ?? null);
  const week = detail.weeks.find((w) => w.id === weekId) ?? null;
  const adminWeek = detail.adminWeeks.find((w) => w.id === weekId) ?? null;
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, body: Record<string, unknown>, okMsg?: string) {
    setBusy(label);
    try {
      await post(body);
      toast({ tone: "success", title: okMsg ?? "Saved" });
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(null);
    }
  }

  const l = detail.league;
  return (
    <div className="space-y-6">
      <PageHeader
        title={l.name}
        description={`${l.location.name} · ${detail.standings.length} players · championship pot ${formatMoney(l.championshipPotCents)}`}
        meta={
          <>
            <Badge tone={l.status === "COMPLETE" ? "muted" : "success"}>{l.status}</Badge>
            <Link href={`/league/${l.id}`} target="_blank" className="text-apple-xs text-apple-blue hover:underline">Public page ↗</Link>
            <Link href={adminRoutes.league()} className="text-apple-xs text-apple-text-secondary hover:underline">All leagues</Link>
          </>
        }
      />
      <nav className="flex flex-wrap gap-1 border-b border-apple-divider">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2.5 text-apple-sm font-medium capitalize ${tab === t ? "border-b-2 border-apple-blue text-apple-text" : "text-apple-text-secondary hover:text-apple-text"}`}>
            {t}
          </button>
        ))}
      </nav>

      {tab === "weeks" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {detail.weeks.map((w) => (
              <button key={w.id} onClick={() => setWeekId(w.id)} className={`rounded-apple-pill border px-3 py-1.5 text-apple-sm ${weekId === w.id ? "border-apple-blue bg-apple-blue text-white" : "border-apple-border bg-white text-apple-text-secondary"}`}>
                {w.isChampionship ? "Champ" : `Wk ${w.weekNumber}`} <span className="opacity-70">· {w.status.toLowerCase()}</span>
              </button>
            ))}
          </div>
          {week && adminWeek ? <WeekPanel detail={detail} week={week} adminWeek={adminWeek} busy={busy} run={run} /> : null}
        </div>
      ) : null}

      {tab === "standings" ? <StandingsPanel detail={detail} /> : null}
      {tab === "players" ? <PlayersPanel detail={detail} busy={busy} run={run} /> : null}
      {tab === "settings" ? <SettingsPanel detail={detail} busy={busy} run={run} /> : null}
      {tab === "money" ? <MoneyPanel detail={detail} busy={busy} run={run} /> : null}
    </div>
  );
}

/* ───────────────────────── Weeks ───────────────────────── */

function WeekPanel({ detail, week, adminWeek, busy, run }: { detail: Detail; week: WeekView; adminWeek: AdminWeek; busy: string | null; run: (l: string, b: Record<string, unknown>, ok?: string) => Promise<void> }) {
  const [course, setCourse] = useState(week.courseName ?? "");
  const [deadline, setDeadline] = useState(toLocalInput(week.deadlineAt));
  const [scoreModal, setScoreModal] = useState<{ playerId: string; holes: string[]; scoreId?: string } | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const playerName = (id: string) => detail.players.find((p) => p.id === id)?.name ?? "?";
  const scoredIds = new Set(adminWeek.scores.map((s) => s.playerId));
  const unscored = detail.players.filter((p) => p.active && !scoredIds.has(p.id));

  async function saveScore() {
    if (!scoreModal) return;
    const holes = scoreModal.holes.map((h) => Number(h));
    if (scoreModal.scoreId) await run("score", { action: "review-score", scoreId: scoreModal.scoreId, status: "ACCEPTED", holes }, "Score updated");
    else await run("score", { action: "set-score", leagueId: detail.league.id, weekId: week.id, playerId: scoreModal.playerId, holes }, "Score entered");
    setScoreModal(null);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader title={`Week ${week.weekNumber}`} subtitle={`${week.status} · deadline ${week.deadlineLabel}`} />
        <div className="mt-4 space-y-3">
          <Input label="Course" value={course} onChange={(e) => setCourse(e.target.value)} />
          <Input label="Deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} disabled={week.status === "FINAL"} hint="Local browser time" />
          <Button size="sm" variant="secondary" loading={busy === "week"} onClick={() => run("week", { action: "update-week", weekId: week.id, courseName: course, ...(week.status !== "FINAL" ? { deadlineAt: new Date(deadline).toISOString() } : {}) })}>Save week</Button>
          <div className="grid grid-cols-3 gap-2 pt-2 text-apple-sm">
            <Kpi label="Pot" value={formatMoney(week.potCents)} />
            <Kpi label="Scores" value={String(week.submittedCount)} />
            <Kpi label="→ Champ." value={formatMoney(week.toChampionshipCents)} />
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            {week.status !== "FINAL" ? (
              <Button size="sm" variant="secondary" loading={busy === "teams"} onClick={() => run("teams", { action: "redraw-teams", weekId: week.id }, "Teams redrawn")}>Redraw teams</Button>
            ) : null}
            <Button
              size="sm"
              variant={week.status === "CLOSED" ? "primary" : "secondary"}
              loading={busy === "finalize"}
              onClick={() => {
                if (week.status === "OPEN" && !confirm("This week is still open. Finalizing now reveals all scores and closes submissions. Continue?")) return;
                void run("finalize", { action: "finalize-week", weekId: week.id, recompute: week.status === "FINAL" }, week.status === "FINAL" ? "Week recomputed" : "Week finalized");
              }}
            >
              {week.status === "FINAL" ? "Recompute" : "Finalize now"}
            </Button>
          </div>
          <p className="text-apple-xs text-apple-text-tertiary">Weeks finalize automatically within 15 minutes of the deadline. Recompute after editing a score.</p>
        </div>
      </Card>

      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader title="Scores" subtitle={week.revealed ? "Revealed" : "Hidden from players until the deadline"} action={unscored.length ? <Button size="sm" variant="secondary" onClick={() => setScoreModal({ playerId: unscored[0]!.id, holes: Array(18).fill("4") })}>Enter score</Button> : null} />
          <div className="mt-3 divide-y divide-apple-divider">
            {adminWeek.scores.length === 0 ? <div className="py-3 text-apple-sm text-apple-text-secondary">No scores yet.</div> : null}
            {adminWeek.scores.map((s) => {
              const entry = adminWeek.entries.find((e) => e.playerId === s.playerId);
              const chk = (s.ocrSettings as { check?: { hard?: string[]; soft?: string[] } } | null)?.check;
              return (
                <div key={s.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-apple-text">{s.name} <span className="ml-1 text-apple-xs text-apple-text-tertiary">{s.source.toLowerCase()} · {fmt(s.submittedAt)}</span></div>
                      <div className="text-apple-xs text-apple-text-secondary">
                        {s.front9} + {s.back9} = <b>{s.gross}</b>{s.handicap != null ? ` · hcp ${s.handicap} · net ${s.net}` : ""}
                        {entry ? <> · entry <Badge size="sm" tone={entry.status === "PAID" || entry.status === "WAIVED" ? "success" : entry.status === "FAILED" ? "danger" : "warn"}>{entry.status}</Badge></> : null}
                      </div>
                      {chk?.soft?.length ? <div className="mt-1 text-apple-xs text-apple-orange">{chk.soft.join(" ")}</div> : null}
                      {s.rejectReason ? <div className="mt-1 text-apple-xs text-apple-red">{s.rejectReason}</div> : null}
                    </div>
                    <Badge tone={s.status === "ACCEPTED" ? "success" : s.status === "REJECTED" ? "danger" : "info"}>{s.status}</Badge>
                    {s.imageId ? <Button size="sm" variant="ghost" onClick={() => setImageId(s.imageId)}>Image</Button> : null}
                    <Button size="sm" variant="ghost" onClick={() => setScoreModal({ playerId: s.playerId, holes: s.holes.map(String), scoreId: s.id })}>Edit</Button>
                    {s.status !== "REJECTED" ? (
                      <Button size="sm" variant="danger" loading={busy === `rej-${s.id}`} onClick={() => { const r = prompt("Reason for rejecting this score?"); if (r != null) void run(`rej-${s.id}`, { action: "review-score", scoreId: s.id, status: "REJECTED", rejectReason: r }, "Score rejected"); }}>Reject</Button>
                    ) : (
                      <Button size="sm" variant="secondary" loading={busy === `acc-${s.id}`} onClick={() => run(`acc-${s.id}`, { action: "review-score", scoreId: s.id, status: "ACCEPTED" }, "Score accepted")}>Accept</Button>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-9 gap-0.5 text-center text-[11px] tabular-nums sm:grid-cols-18">
                    {s.holes.map((h, i) => <div key={i} className="rounded bg-apple-fill-secondary py-0.5 text-apple-text-secondary"><span className="block text-[9px] text-apple-text-tertiary">{i + 1}</span>{h}</div>)}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="Entries" subtitle="Weekly $ charged to cards on file at submission. Declined cards reject the submission — the player re-submits after adding a card. Waive only for comps." />
          <div className="mt-3 divide-y divide-apple-divider">
            {adminWeek.entries.length === 0 ? <div className="py-3 text-apple-sm text-apple-text-secondary">No entries yet.</div> : null}
            {adminWeek.entries.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 py-2 text-apple-sm">
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{e.name}</span> <span className="text-apple-text-secondary">· {formatMoney(e.feeCents)} · {e.source.toLowerCase()}</span>
                  {e.failureReason ? <div className="text-apple-xs text-apple-red">{e.failureReason}</div> : null}
                </div>
                <Badge tone={e.status === "PAID" || e.status === "WAIVED" ? "success" : e.status === "FAILED" ? "danger" : "warn"}>{e.status}</Badge>
                {e.invoiceId ? <Link href={adminRoutes.loc.billing.invoiceDetail(detail.league.location.slug, e.invoiceId)} className="text-apple-xs text-apple-blue hover:underline">Invoice</Link> : null}
                {e.status === "FAILED" || e.status === "PENDING" ? (
                  <Button size="sm" variant="ghost" loading={busy === `waive-${e.id}`} onClick={() => run(`waive-${e.id}`, { action: "entry-waive", entryId: e.id }, "Entry waived")}>Waive</Button>
                ) : null}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Teams & matches" subtitle={week.teams.length ? `${week.teams.length} teams` : "Drawn when the previous week closes"} />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {week.teams.map((t) => (
              <div key={t.teamNumber} className="rounded-apple-sm border border-apple-border p-3 text-apple-sm">
                <div className="flex items-center justify-between">
                  <span className="text-apple-xs font-semibold text-apple-text-tertiary">TEAM {t.teamNumber} {t.opponentTeamNumber ? `vs ${t.opponentTeamNumber}` : "· bye"}</span>
                  {week.revealed ? <span className={`text-apple-xs font-semibold ${t.won ? "text-apple-green" : t.won === false ? "text-apple-red" : "text-apple-text-tertiary"}`}>{t.outcome === "BYE" ? "Bye" : t.outcome === "NOT_PLAYED" ? "—" : `${t.holesFor}–${t.holesAgainst} ${t.won ? "W" : t.won === false ? "L" : t.outcome === "TIE" ? "T" : ""}`}</span> : null}
                </div>
                <div className="mt-1 font-medium">{t.players.map((p) => p.name).join(" & ")}</div>
              </div>
            ))}
          </div>
        </Card>

        {week.payouts.length ? (
          <Card>
            <CardHeader title="Payouts" subtitle={`${formatMoney(week.payouts.reduce((s, p) => s + p.amountCents, 0))} paid out · ${formatMoney(week.toChampionshipCents)} to championship pot`} />
            <div className="mt-3 divide-y divide-apple-divider text-apple-sm">
              {week.payouts.map((p, i) => (
                <div key={i} className="flex items-center justify-between py-2">
                  <span>{p.name} <span className="text-apple-text-tertiary">· {p.kind}</span></span>
                  <span className="font-semibold text-apple-green">{formatMoney(p.amountCents)}</span>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </div>

      <Modal
        open={!!scoreModal}
        onClose={() => setScoreModal(null)}
        title={scoreModal?.scoreId ? `Edit score · ${playerName(scoreModal.playerId)}` : "Enter score"}
        footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setScoreModal(null)}>Cancel</Button><Button loading={busy === "score"} onClick={saveScore}>Save</Button></div>}
      >
        {scoreModal ? (
          <div className="space-y-3">
            {!scoreModal.scoreId ? (
              <Select label="Player" value={scoreModal.playerId} onChange={(e) => setScoreModal({ ...scoreModal, playerId: e.target.value })}>
                {unscored.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            ) : null}
            <div className="grid grid-cols-9 gap-1">
              {scoreModal.holes.map((h, i) => (
                <label key={i} className="text-center text-[10px] text-apple-text-tertiary">
                  {i + 1}
                  <input className="mt-0.5 w-full rounded border border-apple-border px-1 py-1 text-center text-apple-sm" inputMode="numeric" value={h} onChange={(e) => { const holes = [...scoreModal.holes]; holes[i] = e.target.value.replace(/\D/g, "").slice(0, 2); setScoreModal({ ...scoreModal, holes }); }} />
                </label>
              ))}
            </div>
            <div className="text-apple-sm text-apple-text-secondary">Total: <b>{scoreModal.holes.reduce((s, h) => s + (Number(h) || 0), 0)}</b></div>
          </div>
        ) : null}
      </Modal>

      <Modal open={!!imageId} onClose={() => setImageId(null)} title="Scorecard image" wide>
        {imageId ? <img src={`/api/admin/league/image?id=${imageId}`} alt="Scorecard" className="w-full rounded-apple-sm" /> : null}
      </Modal>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-apple-sm bg-apple-fill-secondary p-2">
      <div className="text-[10px] uppercase tracking-wide text-apple-text-tertiary">{label}</div>
      <div className="font-semibold text-apple-text">{value}</div>
    </div>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ───────────────────────── Standings ───────────────────────── */

function StandingsPanel({ detail }: { detail: Detail }) {
  return (
    <Card padded={false}>
      <table className="w-full text-apple-sm">
        <thead className="bg-apple-fill-secondary text-left text-apple-xs uppercase tracking-wide text-apple-text-tertiary">
          <tr><th className="px-4 py-2">#</th><th className="px-4 py-2">Player</th><th className="px-4 py-2 text-right">Pts</th><th className="px-4 py-2 text-right">Straight</th><th className="px-4 py-2 text-right">Hcp pts</th><th className="px-4 py-2 text-right">Team</th><th className="px-4 py-2 text-right">Rounds</th><th className="px-4 py-2 text-right">Hcp</th><th className="px-4 py-2 text-right">Winnings</th></tr>
        </thead>
        <tbody className="divide-y divide-apple-divider">
          {detail.standings.map((s) => (
            <tr key={s.playerId} className={s.championshipQualified ? "bg-apple-green/5" : ""}>
              <td className="px-4 py-2 tabular-nums">{s.rank}</td>
              <td className="px-4 py-2"><Link href={`/league/${detail.league.id}/player/${s.playerId}`} target="_blank" className="hover:underline">{s.name}</Link> {s.isMinor ? <Badge size="sm" tone="info">U18</Badge> : null}{s.championshipQualified ? <Badge size="sm" tone="success">Champ</Badge> : null}</td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums">{s.points}</td>
              <td className="px-4 py-2 text-right tabular-nums">{s.grossPoints}</td>
              <td className="px-4 py-2 text-right tabular-nums">{s.netPoints}</td>
              <td className="px-4 py-2 text-right tabular-nums">{s.teamPoints}</td>
              <td className="px-4 py-2 text-right tabular-nums">{s.rounds}</td>
              <td className="px-4 py-2 text-right tabular-nums">{s.handicap ?? "—"}</td>
              <td className="px-4 py-2 text-right tabular-nums text-apple-green">{formatMoney(s.earningsCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ───────────────────────── Players ───────────────────────── */

function PlayersPanel({ detail, busy, run }: { detail: Detail; busy: string | null; run: (l: string, b: Record<string, unknown>, ok?: string) => Promise<void> }) {
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [memberQ, setMemberQ] = useState("");
  const [results, setResults] = useState<{ id: string; firstName: string; lastName: string; phone: string | null }[]>([]);
  const rows = useMemo(() => detail.players.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.member.phone ?? "").includes(q)), [detail.players, q]);

  async function search() {
    try {
      const j = await post({ action: "search-members", leagueId: detail.league.id, q: memberQ });
      setResults(Array.isArray(j.members) ? j.members : []);
    } catch {
      setResults([]);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search players" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Button variant="secondary" onClick={() => setAddOpen(true)}>Add member</Button>
      </div>
      <Card padded={false}>
        <table className="w-full text-apple-sm">
          <thead className="bg-apple-fill-secondary text-left text-apple-xs uppercase tracking-wide text-apple-text-tertiary">
            <tr><th className="px-4 py-2">Player</th><th className="px-4 py-2">Scorecard name</th><th className="px-4 py-2">Joined</th><th className="px-4 py-2">Flags</th><th className="px-4 py-2 text-right">Rounds</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody className="divide-y divide-apple-divider">
            {rows.map((p) => (
              <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                <td className="px-4 py-2">
                  <Link href={adminRoutes.loc.members.detail(detail.league.location.slug, p.memberId)} className="font-medium hover:underline">{p.member.firstName} {p.member.lastName}</Link>
                  <div className="text-apple-xs text-apple-text-tertiary">{p.member.phone ?? p.member.email ?? ""}</div>
                </td>
                <td className="px-4 py-2">
                  <input defaultValue={p.displayName ?? ""} placeholder={p.name} className="w-40 rounded border border-apple-border px-2 py-1 text-apple-sm" onBlur={(e) => { if ((e.target.value || null) !== (p.displayName ?? null)) void run(`dn-${p.id}`, { action: "update-player", playerId: p.id, displayName: e.target.value || null }, "Name saved"); }} />
                </td>
                <td className="px-4 py-2 text-apple-text-secondary">{new Date(p.joinedAt).toLocaleDateString()} · {p.joinedVia.toLowerCase()}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {p.isMinor ? <Badge size="sm" tone="info">Under 18</Badge> : null}
                    {!p.winningsEligible ? <Badge size="sm" tone="warn">No $</Badge> : null}
                    {!p.active ? <Badge size="sm" tone="muted">Inactive</Badge> : null}
                  </div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{p.scoreCount}</td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" loading={busy === `m-${p.id}`} onClick={() => run(`m-${p.id}`, { action: "update-player", playerId: p.id, isMinor: !p.isMinor, winningsEligible: p.isMinor }, p.isMinor ? "Marked adult" : "Marked under 18")}>{p.isMinor ? "Adult" : "U18"}</Button>
                    <Button size="sm" variant="ghost" loading={busy === `a-${p.id}`} onClick={() => run(`a-${p.id}`, { action: "update-player", playerId: p.id, active: !p.active }, p.active ? "Deactivated" : "Reactivated")}>{p.active ? "Deactivate" : "Reactivate"}</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add member to league" description="Members can also join themselves from the app or kiosk.">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Name or phone" value={memberQ} onChange={(e) => setMemberQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
            <Button variant="secondary" onClick={search}>Search</Button>
          </div>
          <div className="divide-y divide-apple-divider">
            {results.map((m) => (
              <div key={m.id} className="flex items-center justify-between py-2 text-apple-sm">
                <span>{m.firstName} {m.lastName} <span className="text-apple-text-tertiary">{m.phone ?? ""}</span></span>
                <Button size="sm" loading={busy === `add-${m.id}`} onClick={async () => { await run(`add-${m.id}`, { action: "add-player", leagueId: detail.league.id, memberId: m.id }, "Added"); setAddOpen(false); }}>Add</Button>
              </div>
            ))}
            {results.length === 0 ? <div className="py-2 text-apple-xs text-apple-text-tertiary">Search for a member to add.</div> : null}
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ───────────────────────── Settings ───────────────────────── */

function SettingsPanel({ detail, busy, run }: { detail: Detail; busy: string | null; run: (l: string, b: Record<string, unknown>, ok?: string) => Promise<void> }) {
  const l = detail.league;
  const [f, setF] = useState({
    name: l.name,
    description: l.description ?? "",
    status: l.status,
    weeklyFee: String(l.weeklyFeeCents / 100),
    minorAge: String(l.minorAge),
    openingWeeks: String(l.openingWeeks),
    handicapCap: String(l.handicapCap),
    throwOutEvery: String(l.throwOutEvery),
    pointsTop5: String(l.pointsTop5),
    pointsTop10: String(l.pointsTop10),
    pointsTop15: String(l.pointsTop15),
    pointsTeamWin: String(l.pointsTeamWin),
    pointsTeamTie: String(l.pointsTeamTie),
    firstPlacePct: String(l.firstPlacePct),
    firstPlaceCap: String(l.firstPlaceCapCents / 100),
    secondPlacePct: String(l.secondPlacePct),
    secondPlaceCap: String(l.secondPlaceCapCents / 100),
    championshipTopPct: String(l.championshipTopPct),
    championshipAt: l.championshipAt ? l.championshipAt.slice(0, 10) : "",
    championshipNote: l.championshipNote ?? "",
    gimme: String(l.gimmeDistanceFt),
    mulligans: l.mulligans,
    greenSpeed: l.greenSpeed,
    teeRules: JSON.stringify(l.teeRules ?? [], null, 0),
    rulesUrl: l.rulesUrl ?? "",
  });
  const n = (k: keyof typeof f) => Number(f[k]);
  function save() {
    let teeRules: unknown = null;
    try { teeRules = JSON.parse(f.teeRules || "[]"); } catch { return alert("Tee rules must be valid JSON"); }
    void run("settings", {
      action: "update", id: l.id,
      name: f.name, description: f.description || null, status: f.status,
      weeklyFeeCents: Math.round(n("weeklyFee") * 100), minorAge: n("minorAge"), openingWeeks: n("openingWeeks"), handicapCap: n("handicapCap"), throwOutEvery: n("throwOutEvery"),
      pointsTop5: n("pointsTop5"), pointsTop10: n("pointsTop10"), pointsTop15: n("pointsTop15"), pointsTeamWin: n("pointsTeamWin"), pointsTeamTie: n("pointsTeamTie"),
      firstPlacePct: n("firstPlacePct"), firstPlaceCapCents: Math.round(n("firstPlaceCap") * 100), secondPlacePct: n("secondPlacePct"), secondPlaceCapCents: Math.round(n("secondPlaceCap") * 100),
      championshipTopPct: n("championshipTopPct"), championshipAt: f.championshipAt ? new Date(`${f.championshipAt}T12:00:00`).toISOString() : null, championshipNote: f.championshipNote || null,
      gimmeDistanceFt: n("gimme"), mulligans: f.mulligans, greenSpeed: f.greenSpeed, teeRules, rulesUrl: f.rulesUrl || null,
    }, "Settings saved");
  }
  const I = (label: string, k: keyof typeof f, type = "text", hint?: string) => <Input label={label} type={type} value={String(f[k])} hint={hint} onChange={(e) => setF({ ...f, [k]: e.target.value })} />;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="League" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {I("Name", "name")}
          <Select label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
            {["DRAFT", "OPEN", "ACTIVE", "COMPLETE"].map((s) => <option key={s}>{s}</option>)}
          </Select>
          <div className="sm:col-span-2"><Textarea label="Description" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          {I("Rules URL (optional override)", "rulesUrl")}
        </div>
      </Card>
      <Card>
        <CardHeader title="Game settings" subtitle="Shown in the app and on the kiosk League screen. Mulligans must match what OCR reads on the scorecard." />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {I("Gimme distance (ft)", "gimme", "number")}
          <Select label="Mulligans" value={f.mulligans ? "on" : "off"} onChange={(e) => setF({ ...f, mulligans: e.target.value === "on" })}><option value="off">Off</option><option value="on">On</option></Select>
          {I("Green speed", "greenSpeed")}
          <div className="sm:col-span-3"><Textarea label="Tee rules (JSON: [{label, maxAge|null, tee}])" rows={3} value={f.teeRules} onChange={(e) => setF({ ...f, teeRules: e.target.value })} /></div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Entry, handicaps & points" />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {I("Weekly entry ($)", "weeklyFee", "number")}
          {I("Minor age (free, no $)", "minorAge", "number")}
          {I("Opening weeks (straight)", "openingWeeks", "number")}
          {I("Handicap cap (strokes back)", "handicapCap", "number")}
          {I("Throw out highest every N rounds", "throwOutEvery", "number")}
          <div />
          {I("Points top 5", "pointsTop5", "number")}
          {I("Points top 10", "pointsTop10", "number")}
          {I("Points top 15", "pointsTop15", "number")}
          {I("Points team win", "pointsTeamWin", "number")}
          {I("Points team tie", "pointsTeamTie", "number")}
        </div>
      </Card>
      <Card>
        <CardHeader title="Money & championship" />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {I("1st place % of pot", "firstPlacePct", "number")}
          {I("1st place cap ($)", "firstPlaceCap", "number")}
          <div />
          {I("2nd place % of pot", "secondPlacePct", "number")}
          {I("2nd place cap ($)", "secondPlaceCap", "number")}
          <div />
          {I("Championship: top % qualify", "championshipTopPct", "number")}
          {I("Championship date", "championshipAt", "date")}
          {I("Championship note", "championshipNote")}
        </div>
      </Card>
      <div className="flex justify-end"><Button loading={busy === "settings"} onClick={save}>Save settings</Button></div>
    </div>
  );
}

/* ───────────────────────── Money ───────────────────────── */

function MoneyPanel({ detail, busy, run }: { detail: Detail; busy: string | null; run: (l: string, b: Record<string, unknown>, ok?: string) => Promise<void> }) {
  const l = detail.league;
  const qualified = detail.standings.filter((s) => s.championshipQualified);
  const [awards, setAwards] = useState<Record<string, string>>({});
  const total = Object.values(awards).reduce((s, v) => s + Math.round((Number(v) || 0) * 100), 0);
  const collected = detail.weeks.reduce((s, w) => s + w.potCents, 0);
  const paid = detail.weeks.reduce((s, w) => s + w.payouts.reduce((x, p) => x + p.amountCents, 0), 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Card><div className="text-apple-xs uppercase text-apple-text-tertiary">Collected</div><div className="text-apple-xl font-semibold">{formatMoney(collected)}</div></Card>
        <Card><div className="text-apple-xs uppercase text-apple-text-tertiary">Weekly payouts</div><div className="text-apple-xl font-semibold">{formatMoney(paid)}</div></Card>
        <Card><div className="text-apple-xs uppercase text-apple-text-tertiary">Championship pot</div><div className="text-apple-xl font-semibold text-apple-green">{formatMoney(l.championshipPotCents)}</div></Card>
        <Card><div className="text-apple-xs uppercase text-apple-text-tertiary">Qualified</div><div className="text-apple-xl font-semibold">{qualified.length} <span className="text-apple-sm text-apple-text-tertiary">top {l.championshipTopPct}%</span></div></Card>
      </div>
      <Card>
        <CardHeader title="Winnings by player" subtitle="Paid at the front desk. Players see their total on their profile." />
        <table className="mt-3 w-full text-apple-sm">
          <tbody className="divide-y divide-apple-divider">
            {detail.standings.filter((s) => s.earningsCents > 0).map((s) => (
              <tr key={s.playerId}><td className="py-2">{s.name}</td><td className="py-2 text-right font-semibold tabular-nums text-apple-green">{formatMoney(s.earningsCents)}</td></tr>
            ))}
            {detail.standings.every((s) => !s.earningsCents) ? <tr><td className="py-2 text-apple-text-secondary">No payouts yet.</td></tr> : null}
          </tbody>
        </table>
      </Card>
      {l.status !== "COMPLETE" ? (
        <Card>
          <CardHeader title="Award the League Championship" subtitle={`Distribute 100% of the championship pot (${formatMoney(l.championshipPotCents)}). Awarding closes the league.`} />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {qualified.map((s) => (
              <div key={s.playerId} className="flex items-center gap-2 text-apple-sm">
                <span className="w-6 text-right text-apple-text-tertiary">{s.rank}</span>
                <span className="flex-1 truncate">{s.name}{s.isMinor ? " (U18 · no $)" : ""}</span>
                <input className="w-24 rounded border border-apple-border px-2 py-1 text-right" placeholder="$0" inputMode="decimal" value={awards[s.playerId] ?? ""} disabled={!s.winningsEligible} onChange={(e) => setAwards({ ...awards, [s.playerId]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className={`text-apple-sm ${total > l.championshipPotCents ? "text-apple-red" : "text-apple-text-secondary"}`}>Total {formatMoney(total)} of {formatMoney(l.championshipPotCents)}</div>
            <Button loading={busy === "champ"} disabled={total <= 0 || total > l.championshipPotCents} onClick={() => { if (confirm(`Award ${formatMoney(total)} and close the league?`)) void run("champ", { action: "award-championship", leagueId: l.id, awards: Object.entries(awards).filter(([, v]) => Number(v) > 0).map(([playerId, v]) => ({ playerId, amountCents: Math.round(Number(v) * 100), note: "League Championship" })) }, "Championship awarded"); }}>Award & close</Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
