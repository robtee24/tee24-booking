"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, useToast } from "@/components/ui";
import { BarChart } from "@/components/ui/charts";
import { api, errMsg, FlagList, fmtDate, n0, n1, signed, SOURCE_LABEL, Stat, SwingHeader, type Flag } from "../../shared";

type ClubStats = {
  club: string; group: string; n: number;
  carry: { mean: number; sd: number; cv: number } | null; total: number | null; ballSpeed: number | null; clubSpeed: number | null; smash: number | null;
  launchAngle: number | null; backSpin: number | null; spinAxis: number | null; sideSpin: number | null; offlineSd: number | null; offlineMean: number | null;
  launchDirSd: number | null; attackAngle: number | null; faceToPath: number | null; clubPath: number | null; descentAngle: number | null; apex: number | null;
};
type Shot = { id: string; club: string; ballSpeed: number | null; clubSpeed: number | null; smashFactor: number | null; launchAngle: number | null; launchDir: number | null; backSpin: number | null; sideSpin: number | null; carry: number | null; total: number | null; offline: number | null; apex: number | null; clubPath: number | null; faceAngle: number | null; faceToPath: number | null; attackAngle: number | null; shotAt: string | null };
type Session = {
  id: string; source: string; playedAt: string; durationMin: number | null; title: string | null; notes: string | null; shotCount: number; fileName: string | null;
  summary: { shots: number; clubs: ClubStats[]; flags: Flag[]; highlights: string[]; unitNotes?: string[]; unmatchedColumns?: string[] } | null;
  shots: Shot[];
};

export function SessionDetail({ id, readOnly }: { id: string; readOnly: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [s, setS] = React.useState<Session | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [club, setClub] = React.useState<string>("all");
  const [page, setPage] = React.useState(0);

  React.useEffect(() => {
    api<{ session: Session }>(`/api/portal/practice/sessions/${id}`).then((r) => setS(r.session)).catch((e) => setError(errMsg(e)));
  }, [id]);

  async function remove() {
    if (!confirm("Delete this session and its shots?")) return;
    try {
      await api(`/api/portal/practice/sessions/${id}`, { method: "DELETE" });
      toast({ tone: "success", title: "Session deleted" });
      router.push("/portal/swing");
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't delete", description: errMsg(e) });
    }
  }

  const clubs = s?.summary?.clubs ?? [];
  const shots = React.useMemo(() => (s ? (club === "all" ? s.shots : s.shots.filter((x) => x.club === club)) : []), [s, club]);
  const PAGE = 50;
  const pageShots = shots.slice(page * PAGE, (page + 1) * PAGE);
  const carryData = clubs.filter((c) => c.carry).map((c) => ({ club: c.club, carry: Math.round(c.carry!.mean), spread: Math.round(c.carry!.sd) }));

  return (
    <div className="space-y-6">
      <SwingHeader />
      <Link href="/portal/swing" className="inline-flex items-center gap-1 text-apple-sm text-apple-text-secondary hover:text-apple-text"><ArrowLeft className="h-4 w-4" /> All sessions</Link>

      {error && <div className="rounded-apple-sm bg-apple-red/10 px-4 py-3 text-apple-sm text-apple-red">{error}</div>}
      {!s && !error && <p className="text-apple-sm text-apple-text-tertiary">Loading…</p>}

      {s && (
        <>
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-apple-xl font-semibold text-apple-text">{s.title ?? SOURCE_LABEL[s.source] ?? "Session"}</h2>
                <div className="text-apple-sm text-apple-text-secondary">
                  {fmtDate(s.playedAt, { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · {SOURCE_LABEL[s.source] ?? s.source}{s.durationMin ? ` · ${s.durationMin} min` : ""}{s.fileName ? ` · ${s.fileName}` : ""}
                </div>
                {s.notes && <p className="mt-2 text-apple-sm text-apple-text-secondary">{s.notes}</p>}
              </div>
              {!readOnly && <Button variant="danger" size="sm" iconLeft={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void remove()}>Delete</Button>}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Shots" value={s.shotCount} />
              <Stat label="Clubs" value={clubs.length} />
              <Stat label="Flags" value={s.summary?.flags.length ?? 0} />
              <Stat label="Highlights" value={s.summary?.highlights.length ?? 0} />
            </div>
          </Card>

          {(s.summary?.highlights.length || s.summary?.flags.length) ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="What the numbers say" subtitle="Patterns across this session" />
                <div className="mt-3"><FlagList flags={s.summary?.flags ?? []} /></div>
              </Card>
              <Card>
                <CardHeader title="Highlights" subtitle="Benchmarks you hit" />
                {s.summary?.highlights.length ? (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-apple-sm text-apple-text-secondary">{s.summary.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
                ) : (
                  <p className="mt-3 text-apple-sm text-apple-text-tertiary">Keep grinding — benchmarks show up here as you hit them.</p>
                )}
              </Card>
            </div>
          ) : null}

          {carryData.length > 0 && (
            <Card>
              <CardHeader title="Carry by club" subtitle="Average carry (yards), outliers trimmed" />
              <div className="mt-3"><BarChart data={carryData} xKey="club" series={[{ key: "carry", label: "Carry (yd)" }]} height={220} colorByCell /></div>
            </Card>
          )}

          {clubs.length > 0 && (
            <Card>
              <CardHeader title="Per-club averages" />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-apple-sm">
                  <thead className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">
                    <tr>
                      <th className="py-2 pr-3">Club</th><th className="py-2 pr-3">Shots</th><th className="py-2 pr-3">Carry</th><th className="py-2 pr-3">± Carry</th><th className="py-2 pr-3">Total</th><th className="py-2 pr-3">Ball</th><th className="py-2 pr-3">Club</th><th className="py-2 pr-3">Smash</th><th className="py-2 pr-3">Launch</th><th className="py-2 pr-3">Spin</th><th className="py-2 pr-3">Offline ±</th><th className="py-2 pr-3">AoA</th><th className="py-2 pr-3">Path</th><th className="py-2 pr-3">Face-Path</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-apple-divider">
                    {clubs.map((c) => (
                      <tr key={c.club} className="text-apple-text">
                        <td className="py-2 pr-3 font-medium">{c.club}</td><td className="py-2 pr-3">{c.n}</td><td className="py-2 pr-3">{c.carry ? n0(c.carry.mean) : "—"}</td><td className="py-2 pr-3 text-apple-text-secondary">{c.carry ? n0(c.carry.sd) : "—"}</td>
                        <td className="py-2 pr-3">{n0(c.total)}</td><td className="py-2 pr-3">{n1(c.ballSpeed)}</td><td className="py-2 pr-3">{n1(c.clubSpeed)}</td><td className="py-2 pr-3">{n1(c.smash)}</td><td className="py-2 pr-3">{n1(c.launchAngle, "°")}</td><td className="py-2 pr-3">{n0(c.backSpin)}</td>
                        <td className="py-2 pr-3">{n0(c.offlineSd)}</td><td className="py-2 pr-3">{signed(c.attackAngle, "°")}</td><td className="py-2 pr-3">{signed(c.clubPath, "°")}</td><td className="py-2 pr-3">{signed(c.faceToPath, "°")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {s.shots.length > 0 && (
            <Card>
              <CardHeader
                title="Every shot"
                subtitle={`${shots.length} shot${shots.length === 1 ? "" : "s"}`}
                action={
                  <div className="flex flex-wrap gap-1">
                    <FilterChip active={club === "all"} onClick={() => { setClub("all"); setPage(0); }}>All</FilterChip>
                    {clubs.map((c) => <FilterChip key={c.club} active={club === c.club} onClick={() => { setClub(c.club); setPage(0); }}>{c.club}</FilterChip>)}
                  </div>
                }
              />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-apple-sm">
                  <thead className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">
                    <tr><th className="py-2 pr-3">#</th><th className="py-2 pr-3">Club</th><th className="py-2 pr-3">Carry</th><th className="py-2 pr-3">Total</th><th className="py-2 pr-3">Offline</th><th className="py-2 pr-3">Ball</th><th className="py-2 pr-3">Club</th><th className="py-2 pr-3">Smash</th><th className="py-2 pr-3">Launch</th><th className="py-2 pr-3">Dir</th><th className="py-2 pr-3">Spin</th><th className="py-2 pr-3">Apex</th><th className="py-2 pr-3">AoA</th><th className="py-2 pr-3">Path</th><th className="py-2 pr-3">Face</th></tr>
                  </thead>
                  <tbody className="divide-y divide-apple-divider">
                    {pageShots.map((x, i) => (
                      <tr key={x.id} className="text-apple-text">
                        <td className="py-1.5 pr-3 text-apple-text-tertiary">{page * PAGE + i + 1}</td><td className="py-1.5 pr-3">{x.club}</td><td className="py-1.5 pr-3">{n0(x.carry)}</td><td className="py-1.5 pr-3">{n0(x.total)}</td><td className="py-1.5 pr-3">{signed(x.offline)}</td>
                        <td className="py-1.5 pr-3">{n1(x.ballSpeed)}</td><td className="py-1.5 pr-3">{n1(x.clubSpeed)}</td><td className="py-1.5 pr-3">{n1(x.smashFactor)}</td><td className="py-1.5 pr-3">{n1(x.launchAngle, "°")}</td><td className="py-1.5 pr-3">{signed(x.launchDir, "°")}</td>
                        <td className="py-1.5 pr-3">{n0(x.backSpin)}</td><td className="py-1.5 pr-3">{n0(x.apex)}</td><td className="py-1.5 pr-3">{signed(x.attackAngle, "°")}</td><td className="py-1.5 pr-3">{signed(x.clubPath, "°")}</td><td className="py-1.5 pr-3">{signed(x.faceAngle, "°")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {shots.length > PAGE && (
                <div className="mt-3 flex items-center justify-between text-apple-sm">
                  <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <span className="text-apple-text-tertiary">{page * PAGE + 1}–{Math.min(shots.length, (page + 1) * PAGE)} of {shots.length}</span>
                  <Button variant="secondary" size="sm" disabled={(page + 1) * PAGE >= shots.length} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              )}
            </Card>
          )}

          {s.summary?.unitNotes && s.summary.unitNotes.length > 0 && (
            <p className="text-apple-xs text-apple-text-tertiary">{s.summary.unitNotes.join(" ")}</p>
          )}
          {s.source === "SWING_VIDEO" && s.shots.length === 0 && (
            <Card>
              <Badge tone="info" size="sm">Swing video</Badge>
              <p className="mt-2 text-apple-sm text-apple-text-secondary">This session came from a video analysis. <Link href="/portal/swing/videos" className="font-medium text-apple-blue hover:underline">Open it in Swing videos →</Link></p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-apple-pill px-2.5 py-1 text-apple-xs font-medium transition-colors ${active ? "bg-apple-text text-white" : "bg-apple-fill-secondary text-apple-text-secondary hover:text-apple-text"}`}>
      {children}
    </button>
  );
}
