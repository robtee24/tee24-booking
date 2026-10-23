"use client";

import React from "react";
import Link from "next/link";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { BarChart, LineChart } from "@/components/ui/charts";
import { TrendingUp } from "lucide-react";
import { api, errMsg, FlagList, fmtShort, n0, n1, signed, Stat, SwingHeader, type Flag } from "../shared";

type Point = { sessionId: string; playedAt: string; carry: number | null; carrySd: number | null; smash: number | null; offlineSd: number | null; ballSpeed: number | null; clubSpeed: number | null; backSpin: number | null; n: number };
type ClubTrend = { club: string; points: Point[]; delta: { carry: number | null; smash: number | null; offlineSd: number | null; carrySd: number | null; ballSpeed: number | null } | null };
type Progress = {
  sessions: { id: string; playedAt: string; shotCount: number; title: string | null }[];
  clubs: ClubTrend[];
  flagHistory: { playedAt: string; flags: { key: string; title: string; severity: number; area: string }[] }[];
  currentFlags: Flag[];
  weeks: { weekStart: string; minutes: number; drills: number }[];
  totals: { sessions: number; shots: number; drillsLogged: number; minutesLogged: number };
};

const METRICS = [
  { key: "carry", label: "Carry (yd)", fmt: (v: number) => n0(v) },
  { key: "carrySd", label: "Carry spread ± (yd)", fmt: (v: number) => n0(v) },
  { key: "smash", label: "Smash factor", fmt: (v: number) => n1(v) },
  { key: "ballSpeed", label: "Ball speed (mph)", fmt: (v: number) => n1(v) },
  { key: "clubSpeed", label: "Club speed (mph)", fmt: (v: number) => n1(v) },
  { key: "offlineSd", label: "Offline spread ± (yd)", fmt: (v: number) => n0(v) },
  { key: "backSpin", label: "Back spin (rpm)", fmt: (v: number) => n0(v) },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

export function ProgressClient() {
  const [p, setP] = React.useState<Progress | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [club, setClub] = React.useState<string | null>(null);
  const [metric, setMetric] = React.useState<MetricKey>("carry");

  React.useEffect(() => {
    api<Progress>("/api/portal/practice/progress")
      .then((r) => {
        setP(r);
        const best = [...r.clubs].sort((a, b) => b.points.length - a.points.length)[0];
        setClub(best?.club ?? null);
      })
      .catch((e) => setError(errMsg(e)));
  }, []);

  const trend = p?.clubs.find((c) => c.club === club) ?? null;
  const m = METRICS.find((x) => x.key === metric)!;
  const data = (trend?.points ?? []).filter((pt) => pt[metric] != null).map((pt) => ({ date: fmtShort(pt.playedAt), value: pt[metric] as number, n: pt.n }));
  const weeks = (p?.weeks ?? []).map((w) => ({ week: fmtShort(w.weekStart), minutes: w.minutes, drills: w.drills }));

  return (
    <div className="space-y-6">
      <SwingHeader subtitle="How your numbers are moving across sessions." />
      {error && <div className="rounded-apple-sm bg-apple-red/10 px-4 py-3 text-apple-sm text-apple-red">{error}</div>}
      {!p && !error && <p className="text-apple-sm text-apple-text-tertiary">Loading…</p>}

      {p && p.sessions.length === 0 && (
        <Card>
          <EmptyState icon={<TrendingUp className="h-8 w-8" />} title="No data yet" description="Import at least two sessions to see trends by club." action={<Link href="/portal/swing" className="text-apple-sm font-medium text-apple-blue hover:underline">Import shot data →</Link>} />
        </Card>
      )}

      {p && p.sessions.length > 0 && (
        <>
          <Card>
            <CardHeader
              title="Trend by club"
              subtitle={trend && trend.points.length < 2 ? "Need one more session with this club to draw a trend." : undefined}
              action={
                <div className="flex flex-wrap gap-2">
                  <select value={club ?? ""} onChange={(e) => setClub(e.target.value)} className="h-8 rounded-apple-sm border border-apple-border bg-white px-2 text-apple-sm">
                    {p.clubs.map((c) => <option key={c.club} value={c.club}>{c.club} ({c.points.length})</option>)}
                  </select>
                  <select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)} className="h-8 rounded-apple-sm border border-apple-border bg-white px-2 text-apple-sm">
                    {METRICS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </select>
                </div>
              }
            />
            {trend && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <Stat label="Carry" value={signed(trend.delta?.carry, " yd")} hint="first → latest" />
                  <Stat label="Carry spread" value={signed(trend.delta?.carrySd, " yd")} hint="lower is better" />
                  <Stat label="Smash" value={signed(trend.delta?.smash)} />
                  <Stat label="Ball speed" value={signed(trend.delta?.ballSpeed, " mph")} />
                  <Stat label="Offline spread" value={signed(trend.delta?.offlineSd, " yd")} hint="lower is better" />
                </div>
                <div className="mt-4">
                  {data.length >= 1 ? (
                    <LineChart data={data} xKey="date" series={[{ key: "value", label: m.label }]} height={240} yFormatter={(v) => m.fmt(v)} />
                  ) : (
                    <p className="text-apple-sm text-apple-text-tertiary">No {m.label.toLowerCase()} data for this club.</p>
                  )}
                </div>
              </>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Current focus" subtitle="Recency-weighted across your last sessions" />
              <div className="mt-3"><FlagList flags={p.currentFlags} /></div>
            </Card>
            <Card>
              <CardHeader title="Practice time" subtitle="Minutes logged per week" />
              <div className="mt-3">
                {weeks.some((w) => w.minutes > 0) ? (
                  <BarChart data={weeks} xKey="week" series={[{ key: "minutes", label: "Minutes" }]} height={220} />
                ) : (
                  <p className="text-apple-sm text-apple-text-tertiary">Log drills from your <Link href="/portal/swing/plan" className="font-medium text-apple-blue hover:underline">practice plan</Link> to track time here.</p>
                )}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="Session history" />
            <ul className="mt-3 divide-y divide-apple-divider text-apple-sm">
              {[...p.flagHistory].reverse().map((h, i) => {
                const sess = [...p.sessions].reverse()[i];
                return (
                  <li key={`${h.playedAt}-${i}`} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      {sess ? <Link href={`/portal/swing/sessions/${sess.id}`} className="font-medium text-apple-text hover:underline">{sess.title ?? "Session"}</Link> : <span className="font-medium text-apple-text">Session</span>}
                      <span className="ml-2 text-apple-text-tertiary">{fmtShort(h.playedAt)}{sess ? ` · ${sess.shotCount} shots` : ""}</span>
                    </div>
                    <div className="text-apple-xs text-apple-text-secondary">{h.flags.length ? h.flags.slice(0, 3).map((f) => f.title).join(" · ") : "No flags"}</div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
