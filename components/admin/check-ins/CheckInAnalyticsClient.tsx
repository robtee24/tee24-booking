"use client";

/**
 * Check-in analytics dashboard — combined and per-location usage metrics.
 *
 * Location-wise: average check-ins per day, by day of week, by time window
 * (3-hour blocks by default, or a custom window), top members, peak times.
 * Member-wise: usage rate, average check-ins per member, members without a
 * check-in, breakdown by membership type, visit-frequency distribution.
 */
import React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Download, Search, UserRound } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Select, useToast } from "@/components/ui";
import { BarChart, CHART_COLORS, KpiCard } from "@/components/ui/charts";
import { adminRoutes } from "@/lib/admin/routes";
import type { CheckInAnalytics, LocationAnalytics, MemberWithout } from "@/services/checkin-analytics.service";

export type AnalyticsScope =
  | { kind: "org" }
  | { kind: "location"; locationId: string; slug: string; name: string; timezone: string };

const DAY_OPTIONS = [7, 14, 30, 60, 90];
const BLOCKS = [1, 2, 3, 4, 6];
const SERIES_COLORS = [CHART_COLORS.blue, CHART_COLORS.green, CHART_COLORS.orange, CHART_COLORS.purple];
const WEEKDAYS_MON_FIRST = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function hourLabel(h: number) {
  const hh = ((h % 24) + 24) % 24;
  if (hh === 0) return "12 AM";
  if (hh === 12) return "12 PM";
  return hh < 12 ? `${hh} AM` : `${hh - 12} PM`;
}
function dayLabel(day: string, long = false) {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat(
    "en-US",
    long ? { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" } : { timeZone: "UTC", month: "short", day: "numeric" }
  ).format(dt);
}
function fmtDateTime(iso: string | null, tz: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
function fmtDate(iso: string | null, tz: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}
function pct(n: number) {
  return `${n.toFixed(n % 1 === 0 ? 0 : 1)}%`;
}
function csvEscape(v: string | number | null | undefined) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function CheckInAnalyticsClient({ scope }: { scope: AnalyticsScope }) {
  const { toast } = useToast();
  const [days, setDays] = React.useState(30);
  const [block, setBlock] = React.useState(3);
  const [winStart, setWinStart] = React.useState<number>(21);
  const [winEnd, setWinEnd] = React.useState<number>(23);
  const [winApplied, setWinApplied] = React.useState<{ start: number; end: number } | null>(null);
  const [data, setData] = React.useState<CheckInAnalytics | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [view, setView] = React.useState<string>("combined"); // "combined" | locationId

  const locParam = scope.kind === "location" ? `&locationId=${encodeURIComponent(scope.locationId)}` : "";

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const win = winApplied ? `&winStart=${winApplied.start}&winEnd=${winApplied.end}` : "";
      const r = await fetch(`/api/admin/check-ins/analytics?days=${days}&block=${block}${win}${locParam}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? "Request failed");
      setData(await r.json());
    } catch (e) {
      toast({ tone: "error", title: "Couldn't load analytics", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, [days, block, winApplied, locParam, toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Which slice are we looking at?
  const isOrg = scope.kind === "org";
  const current: LocationAnalytics | null = React.useMemo(() => {
    if (!data) return null;
    if (!isOrg) return data.locations[0] ?? data.combined;
    if (view === "combined") return data.combined;
    return data.locations.find((l) => l.location?.id === view) ?? data.combined;
  }, [data, view, isOrg]);

  const showPerLocationSeries = isOrg && view === "combined" && (data?.locations.length ?? 0) > 1;
  const tz = current?.timezone ?? (scope.kind === "location" ? scope.timezone : "America/New_York");

  // ── Chart data ───────────────────────────────────────────────────────────
  const weekdayChart = React.useMemo(() => {
    if (!data || !current) return { rows: [] as Array<Record<string, number | string>>, series: [] as { key: string; label: string; color: string }[] };
    if (showPerLocationSeries) {
      const rows = WEEKDAYS_MON_FIRST.map((label, i) => {
        const row: Record<string, number | string> = { label };
        data.locations.forEach((l) => {
          row[l.location!.id] = l.byWeekday[i]?.avg ?? 0;
        });
        return row;
      });
      return { rows, series: data.locations.map((l, i) => ({ key: l.location!.id, label: l.location!.name, color: SERIES_COLORS[i % SERIES_COLORS.length] })) };
    }
    return {
      rows: current.byWeekday.map((d) => ({ label: d.label, avg: d.avg })),
      series: [{ key: "avg", label: "Avg check-ins", color: CHART_COLORS.blue }],
    };
  }, [data, current, showPerLocationSeries]);

  const blockChart = React.useMemo(() => {
    if (!data || !current) return { rows: [] as Array<Record<string, number | string>>, series: [] as { key: string; label: string; color: string }[] };
    if (showPerLocationSeries) {
      const rows = current.byBlock.map((b, i) => {
        const row: Record<string, number | string> = { label: b.label };
        data.locations.forEach((l) => {
          row[l.location!.id] = l.byBlock[i]?.avg ?? 0;
        });
        return row;
      });
      return { rows, series: data.locations.map((l, i) => ({ key: l.location!.id, label: l.location!.name, color: SERIES_COLORS[i % SERIES_COLORS.length] })) };
    }
    return {
      rows: current.byBlock.map((b) => ({ label: b.label, avg: b.avg })),
      series: [{ key: "avg", label: "Avg per day", color: CHART_COLORS.green }],
    };
  }, [data, current, showPerLocationSeries]);

  function exportWithout() {
    if (!current) return;
    const header = ["First name", "Last name", "Email", "Membership type", "Location", "Joined", "Last check-in", "Days since"];
    const lines = [header.join(",")].concat(
      current.membersWithout.map((m) =>
        [m.firstName, m.lastName, m.email, m.membershipType, m.locationSlug, m.joinDate?.slice(0, 10) ?? "", m.lastCheckInAt?.slice(0, 10) ?? "never", m.daysSince ?? ""]
          .map(csvEscape)
          .join(",")
      )
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `members-without-checkin-${days}d${current.location ? `-${current.location.slug}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          {isOrg && data && data.locations.length > 1 && (
            <div className="inline-flex rounded-apple-sm border border-apple-border bg-white p-1">
              {[{ id: "combined", name: "Combined" }, ...data.locations.map((l) => ({ id: l.location!.id, name: l.location!.name.replace(/^Tee24\s+/i, "") }))].map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setView(o.id)}
                  className={[
                    "rounded-apple-sm px-3 py-1.5 text-apple-sm font-medium transition-colors",
                    view === o.id ? "bg-apple-green text-white" : "text-apple-text-secondary hover:text-apple-text",
                  ].join(" ")}
                >
                  {o.name}
                </button>
              ))}
            </div>
          )}
          <div className="w-36">
            <Select label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  Last {d} days
                </option>
              ))}
            </Select>
          </div>
        </div>
        {data && (
          <p className="text-apple-xs text-apple-text-tertiary">
            {dayLabel(data.periodStart.slice(0, 10), true)} – today · {data.elapsedDays.toFixed(1)} days elapsed
            {data.dataSince ? ` · data since ${fmtDate(data.dataSince, tz)}` : ""}
          </p>
        )}
      </div>

      {loading && !data ? (
        <Card>
          <div className="py-10 text-center text-apple-sm text-apple-text-tertiary">Crunching check-ins…</div>
        </Card>
      ) : !data || !current ? (
        <Card>
          <EmptyState title="No analytics yet" description="Check-ins will appear here once Kisi unlocks have been synced." />
        </Card>
      ) : (
        <div className={loading ? "space-y-6 opacity-60 transition-opacity" : "space-y-6"}>
          {/* ── Location KPIs ───────────────────────────────────────────── */}
          <section className="space-y-3">
            <h2 className="text-apple-lg font-semibold text-apple-text">
              Location usage{current.location ? ` · ${current.location.name}` : " · all locations"}
            </h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                label="Total check-ins"
                value={current.total.toLocaleString()}
                hint={data.prevPeriodComplete && current.deltaPct != null ? `vs ${current.prevTotal.toLocaleString()} previous ${days} days` : `${current.matched.toLocaleString()} matched to members`}
                delta={data.prevPeriodComplete ? current.deltaPct ?? undefined : undefined}
                trend={current.daily.map((d) => ({ y: d.total }))}
                trendColor={CHART_COLORS.green}
              />
              <KpiCard
                label="Avg check-ins / day"
                value={current.avgPerDay}
                hint={current.peakDay ? `Peak ${dayLabel(current.peakDay.day)} · ${current.peakDay.total}` : undefined}
              />
              <KpiCard
                label="Busiest window"
                value={current.busiestBlock?.label ?? "—"}
                hint={current.busiestBlock ? `${current.busiestBlock.avg}/day · ${pct(current.busiestBlock.share)} of check-ins` : undefined}
              />
              <KpiCard
                label="Weekend share"
                value={pct(current.weekendShare)}
                hint={`${pct(current.unmatchedShare)} guest / unmatched · ${current.avgUnlocksPerCheckIn} unlocks per check-in`}
              />
            </div>
          </section>

          {/* ── Day of week + time of day ──────────────────────────────── */}
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Average check-ins by day of week" subtitle={`Average per occurrence of each weekday in the last ${days} days`} />
              <div className="mt-4">
                <BarChart data={weekdayChart.rows} xKey="label" series={weekdayChart.series} height={240} showLegend={showPerLocationSeries} />
              </div>
              {!showPerLocationSeries && (
                <div className="mt-3 grid grid-cols-7 gap-1 text-center">
                  {current.byWeekday.map((d) => (
                    <div key={d.dow} className="rounded-apple-sm bg-apple-fill-secondary px-1 py-1.5">
                      <div className="text-[10px] uppercase tracking-wide text-apple-text-tertiary">{d.label}</div>
                      <div className="text-apple-sm font-semibold tabular-nums text-apple-text">{d.avg}</div>
                      <div className="text-[10px] text-apple-text-tertiary">{d.total} total</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Average check-ins by time of day"
                subtitle="Average per day in each block (local time)"
                action={
                  <div className="w-28">
                    <Select value={block} onChange={(e) => setBlock(Number(e.target.value))} aria-label="Block size">
                      {BLOCKS.map((b) => (
                        <option key={b} value={b}>
                          {b}-hour
                        </option>
                      ))}
                    </Select>
                  </div>
                }
              />
              <div className="mt-4">
                <BarChart data={blockChart.rows} xKey="label" series={blockChart.series} height={240} showLegend={showPerLocationSeries} />
              </div>

              {/* Custom window */}
              <div className="mt-4 rounded-apple-sm border border-apple-border bg-apple-fill-secondary/60 p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-28">
                    <Select label="Custom from" value={winStart} onChange={(e) => setWinStart(Number(e.target.value))}>
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {hourLabel(h)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-28">
                    <Select label="to" value={winEnd} onChange={(e) => setWinEnd(Number(e.target.value))}>
                      {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                        <option key={h} value={h}>
                          {h === 24 ? "12 AM" : hourLabel(h)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button size="md" variant="secondary" onClick={() => setWinApplied({ start: winStart, end: winEnd })} disabled={winStart === winEnd}>
                    Show window
                  </Button>
                  {winApplied && (
                    <Button size="md" variant="ghost" onClick={() => setWinApplied(null)}>
                      Clear
                    </Button>
                  )}
                </div>
                {current.window && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr] sm:items-start">
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-1">
                      <Stat label={`Avg / day · ${current.window.label}`} value={String(current.window.avgPerDay)} />
                      <Stat label="Total in window" value={current.window.total.toLocaleString()} />
                      <Stat label="Share of all check-ins" value={pct(current.window.share)} />
                    </div>
                    <div>
                      <div className="mb-1 text-apple-xs text-apple-text-tertiary">Average by weekday · {current.window.label}</div>
                      <BarChart
                        data={current.window.byWeekday.map((d) => ({ label: d.label, avg: d.avg }))}
                        xKey="label"
                        series={[{ key: "avg", label: "Avg in window", color: CHART_COLORS.orange }]}
                        height={140}
                      />
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* ── Heatmap ─────────────────────────────────────────────────── */}
          <Card>
            <CardHeader title="Busiest times" subtitle={`Check-ins by weekday and hour over the last ${days} days (darker = busier)`} />
            <HourHeatmap heat={current.heat} />
          </Card>

          {/* ── Top members ─────────────────────────────────────────────── */}
          <Card padded={false}>
            <div className="p-5 pb-3">
              <CardHeader title={`Top members · last ${days} days`} subtitle="Most check-ins (repeat opens within the dedupe window count once)" />
            </div>
            {current.topMembers.length === 0 ? (
              <div className="px-5 pb-5 text-apple-sm text-apple-text-tertiary">No matched check-ins in this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-apple-sm">
                  <thead className="bg-apple-fill-secondary/60 text-apple-xs uppercase tracking-wide text-apple-text-tertiary">
                    <tr>
                      <th className="px-5 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Member</th>
                      <th className="px-3 py-2 font-medium">Membership</th>
                      <th className="px-3 py-2 text-right font-medium">Check-ins</th>
                      <th className="px-3 py-2 text-right font-medium">Per week</th>
                      <th className="px-5 py-2 text-right font-medium">Last check-in</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-apple-divider">
                    {current.topMembers.map((t, i) => (
                      <tr key={t.member.id} className="hover:bg-apple-fill-secondary/40">
                        <td className="px-5 py-2.5 tabular-nums text-apple-text-tertiary">{i + 1}</td>
                        <td className="px-3 py-2.5">
                          <MemberLink m={t.member} />
                        </td>
                        <td className="max-w-[260px] truncate px-3 py-2.5 text-apple-text-secondary" title={t.member.membershipType ?? ""}>
                          {t.member.membershipType ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{t.count}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-apple-text-secondary">{t.perWeek}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-apple-text-secondary">{fmtDateTime(t.lastAt, tz)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ── Member KPIs ─────────────────────────────────────────────── */}
          <section className="space-y-3">
            <h2 className="text-apple-lg font-semibold text-apple-text">Member usage</h2>
            <p className="-mt-2 text-apple-sm text-apple-text-secondary">
              Based on {current.activeMembers.toLocaleString()} active members{current.location ? ` at ${current.location.name}` : ""}.
            </p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                label="Usage rate"
                value={pct(current.usageRate)}
                hint={`${current.visitingMembers.toLocaleString()} of ${current.activeMembers.toLocaleString()} active members checked in`}
              />
              <KpiCard
                label="Avg check-ins / member"
                value={current.avgPerActiveMember}
                hint={`${current.avgPerVisitingMember} among members who visited · median ${current.medianPerVisitingMember}`}
              />
              <KpiCard
                label="Members without a check-in"
                value={current.membersWithoutCheckIn.toLocaleString()}
                hint={`In the last ${days} days · ${current.inactive14d.toLocaleString()} with none in the last 14 days`}
              />
              <KpiCard
                label="Visits / week per active visitor"
                value={current.avgVisitsPerWeekPerVisitingMember}
                hint="Among members with at least one check-in"
              />
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[1fr_1.4fr]">
            {/* Frequency distribution */}
            <Card>
              <CardHeader title="Visit frequency" subtitle={`How often active members checked in over the last ${days} days`} />
              <div className="mt-4">
                <BarChart
                  data={current.frequency.map((f) => ({ label: f.bucket === "0" ? "None" : f.bucket, members: f.members }))}
                  xKey="label"
                  series={[{ key: "members", label: "Members", color: CHART_COLORS.purple }]}
                  height={220}
                  colorByCell
                />
              </div>
              <div className="mt-2 text-apple-xs text-apple-text-tertiary">Number of check-ins per member → how many members fall in each band.</div>
            </Card>

            {/* By membership type */}
            <Card padded={false}>
              <div className="p-5 pb-3">
                <CardHeader title="Average check-ins by membership type" subtitle="Active members grouped by membership label" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-apple-sm">
                  <thead className="bg-apple-fill-secondary/60 text-apple-xs uppercase tracking-wide text-apple-text-tertiary">
                    <tr>
                      <th className="px-5 py-2 font-medium">Membership type</th>
                      <th className="px-3 py-2 text-right font-medium">Members</th>
                      <th className="px-3 py-2 text-right font-medium">Checked in</th>
                      <th className="px-3 py-2 text-right font-medium">Usage</th>
                      <th className="px-3 py-2 text-right font-medium">Check-ins</th>
                      <th className="px-3 py-2 text-right font-medium">Avg / member</th>
                      <th className="px-5 py-2 text-right font-medium">Avg / visitor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-apple-divider">
                    {current.byMembershipType.map((t) => (
                      <tr key={t.type} className="hover:bg-apple-fill-secondary/40">
                        <td className="max-w-[320px] truncate px-5 py-2.5 font-medium text-apple-text" title={t.type}>
                          {t.type}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{t.activeMembers}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{t.visitingMembers}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          <UsagePill value={t.usageRate} />
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{t.checkIns}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{t.avgPerMember}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-apple-text-secondary">{t.avgPerVisitingMember}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 text-apple-xs text-apple-text-tertiary">
                &ldquo;Not set&rdquo; = members whose membership label hasn&apos;t been synced from GymDesk yet.
              </div>
            </Card>
          </div>

          {/* ── Members without a check-in ─────────────────────────────── */}
          <MembersWithoutList rows={current.membersWithout} tz={tz} days={days} onExport={exportWithout} />

          {/* ── Cross-location ─────────────────────────────────────────── */}
          {isOrg && view === "combined" && data.crossLocationMembers.length > 0 && (
            <Card padded={false}>
              <div className="p-5 pb-3">
                <CardHeader title="Members using both locations" subtitle={`${data.crossLocationMembers.length} members checked in at more than one location in the last ${days} days`} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-apple-sm">
                  <thead className="bg-apple-fill-secondary/60 text-apple-xs uppercase tracking-wide text-apple-text-tertiary">
                    <tr>
                      <th className="px-5 py-2 font-medium">Member</th>
                      {data.locations.map((l) => (
                        <th key={l.location!.id} className="px-3 py-2 text-right font-medium">
                          {l.location!.name.replace(/^Tee24\s+/i, "")}
                        </th>
                      ))}
                      <th className="px-5 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-apple-divider">
                    {data.crossLocationMembers.map((r) => (
                      <tr key={r.member.id} className="hover:bg-apple-fill-secondary/40">
                        <td className="px-5 py-2.5">
                          <MemberLink m={r.member} />
                        </td>
                        {data.locations.map((l) => (
                          <td key={l.location!.id} className="px-3 py-2.5 text-right tabular-nums">
                            {r.counts[l.location!.id] ?? 0}
                          </td>
                        ))}
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{r.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-apple-sm bg-white px-3 py-2 shadow-apple">
      <div className="text-[10px] uppercase tracking-wide text-apple-text-tertiary">{label}</div>
      <div className="text-apple-lg font-semibold tabular-nums text-apple-text">{value}</div>
    </div>
  );
}

function UsagePill({ value }: { value: number }) {
  const tone = value >= 50 ? "success" : value >= 25 ? "warn" : "danger";
  return (
    <Badge tone={tone} size="sm">
      {pct(value)}
    </Badge>
  );
}

function MemberLink({ m }: { m: { id: string; firstName: string; lastName: string; email: string | null; locationSlug: string } }) {
  const name = `${m.firstName} ${m.lastName}`.trim() || m.email || "Member";
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-apple-fill-secondary text-apple-text-tertiary">
        <UserRound className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        {m.locationSlug ? (
          <Link href={adminRoutes.loc.members.detail(m.locationSlug, m.id)} className="font-medium text-apple-text hover:text-apple-blue">
            {name}
          </Link>
        ) : (
          <span className="font-medium text-apple-text">{name}</span>
        )}
        {m.email && <div className="truncate text-apple-xs text-apple-text-tertiary">{m.email}</div>}
      </div>
    </div>
  );
}

function HourHeatmap({ heat }: { heat: number[][] }) {
  // heat is [dow 0=Sun..6][hour]; display Mon-first.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const max = Math.max(1, ...heat.flat());
  return (
    <div className="mt-4 overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="grid" style={{ gridTemplateColumns: "44px repeat(24, minmax(0, 1fr))" }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="pb-1 text-center text-[10px] text-apple-text-tertiary">
              {h % 3 === 0 ? hourLabel(h).replace(" ", "") : ""}
            </div>
          ))}
          {order.map((dow) => (
            <React.Fragment key={dow}>
              <div className="pr-2 text-right text-apple-xs leading-6 text-apple-text-tertiary">{WEEKDAYS_MON_FIRST[(dow + 6) % 7]}</div>
              {heat[dow].map((v, h) => {
                const t = v / max;
                const bg = v === 0 ? "#F2F2F7" : `rgba(52, 199, 89, ${0.15 + t * 0.85})`;
                return (
                  <div
                    key={h}
                    title={`${WEEKDAYS_MON_FIRST[(dow + 6) % 7]} ${hourLabel(h)}: ${v} check-in${v === 1 ? "" : "s"}`}
                    className="m-[1px] h-6 rounded-[3px]"
                    style={{ background: bg }}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-end gap-2 text-[10px] text-apple-text-tertiary">
          <span>Fewer</span>
          {[0.15, 0.4, 0.65, 1].map((a) => (
            <span key={a} className="h-3 w-5 rounded-[3px]" style={{ background: `rgba(52, 199, 89, ${a})` }} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}

function MembersWithoutList({ rows, tz, days, onExport }: { rows: MemberWithout[]; tz: string; days: number; onExport: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [showAll, setShowAll] = React.useState(false);
  const filtered = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((m) => `${m.firstName} ${m.lastName} ${m.email ?? ""} ${m.membershipType ?? ""}`.toLowerCase().includes(s));
  }, [rows, q]);
  const visible = showAll ? filtered : filtered.slice(0, 50);
  const never = rows.filter((r) => r.daysSince == null).length;

  return (
    <Card padded={false}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 p-5 text-left">
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 text-apple-text-tertiary" /> : <ChevronRight className="h-4 w-4 text-apple-text-tertiary" />}
          <div>
            <h2 className="text-apple-lg font-semibold text-apple-text">Members without a check-in</h2>
            <p className="mt-0.5 text-apple-sm text-apple-text-secondary">
              {rows.length.toLocaleString()} active members haven&apos;t checked in during the last {days} days
              {never ? ` · ${never.toLocaleString()} have never checked in` : ""}
            </p>
          </div>
        </div>
        <Badge tone={rows.length ? "warn" : "success"}>{rows.length.toLocaleString()}</Badge>
      </button>
      {open && (
        <div className="border-t border-apple-divider">
          <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:max-w-xs">
              <Input prefix={<Search className="h-4 w-4" />} placeholder="Search name, email, membership" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Button size="sm" variant="secondary" iconLeft={<Download className="h-3.5 w-3.5" />} onClick={onExport}>
              Export CSV
            </Button>
          </div>
          {visible.length === 0 ? (
            <div className="px-5 pb-5 text-apple-sm text-apple-text-tertiary">Everyone matched this search has checked in.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-apple-sm">
                <thead className="bg-apple-fill-secondary/60 text-apple-xs uppercase tracking-wide text-apple-text-tertiary">
                  <tr>
                    <th className="px-5 py-2 font-medium">Member</th>
                    <th className="px-3 py-2 font-medium">Membership</th>
                    <th className="px-3 py-2 font-medium">Joined</th>
                    <th className="px-5 py-2 text-right font-medium">Last check-in</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-apple-divider">
                  {visible.map((m) => (
                    <tr key={m.id} className="hover:bg-apple-fill-secondary/40">
                      <td className="px-5 py-2.5">
                        <MemberLink m={m} />
                      </td>
                      <td className="max-w-[260px] truncate px-3 py-2.5 text-apple-text-secondary" title={m.membershipType ?? ""}>
                        {m.membershipType ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-apple-text-secondary">{fmtDate(m.joinDate, tz)}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">
                        {m.lastCheckInAt ? (
                          <span className="text-apple-text-secondary">
                            {fmtDate(m.lastCheckInAt, tz)} <span className="text-apple-text-tertiary">· {m.daysSince}d ago</span>
                          </span>
                        ) : (
                          <Badge tone="danger" size="sm">
                            Never
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!showAll && filtered.length > visible.length && (
            <div className="p-4 text-center">
              <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
                Show all {filtered.length.toLocaleString()}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
