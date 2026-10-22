"use client";

/**
 * Check Ins — shared between the org overview (/admin/check-ins) and a single
 * location (/admin/locations/[slug]/check-ins).
 *
 * Every successful Kisi door unlock becomes a check-in. Members are matched by
 * Kisi email ↔ Member.email (or the Kisi user id mirror when present).
 */
import React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, DoorOpen, RefreshCw, Search, UserRound } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Input, useToast } from "@/components/ui";
import { BarChart, CHART_COLORS, KpiCard } from "@/components/ui/charts";
import { adminRoutes } from "@/lib/admin/routes";

type Range = "today" | "7d" | "30d" | "90d" | "all";
const RANGE_LABEL: Record<Range, string> = { today: "Today", "7d": "7 days", "30d": "30 days", "90d": "90 days", all: "All time" };

type Member = { id: string; firstName: string; lastName: string; email: string | null; phone: string | null };
type Row = {
  id: string;
  enteredAt: string;
  lastUnlockAt: string | null;
  unlockCount: number;
  type: string;
  matchedBy: string | null;
  actorEmail: string | null;
  guestName: string | null;
  notes: string | null;
  member: Member | null;
  door: { id: string; name: string } | null;
  location: { id: string; name: string; slug: string; timezone: string };
  bookingId: string | null;
};
type Overview = {
  total: number;
  matched: number;
  unmatched: number;
  uniqueMembers: number;
  byLocation: Array<{
    location: { id: string; name: string; slug: string };
    total: number;
    matched: number;
    uniqueMembers: number;
    today: number;
  }>;
};
type ByMember = Array<{ member: Member; count: number; lastAt: string | null }>;
type Daily = {
  days: string[];
  locations: Array<{ id: string; name: string; slug: string }>;
  rows: Array<{ day: string; total: number } & Record<string, number | string>>;
};
const SERIES_COLORS = [CHART_COLORS.blue, CHART_COLORS.green, CHART_COLORS.orange, CHART_COLORS.purple];

function dayLabel(day: string, opts: { long?: boolean } = {}) {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat(
    "en-US",
    opts.long ? { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" } : { timeZone: "UTC", month: "short", day: "numeric" }
  ).format(dt);
}

export type CheckInsScope =
  | { kind: "org" }
  | { kind: "location"; locationId: string; slug: string; name: string; timezone: string };

export function fmtTime(iso: string | Date, timeZone: string, opts: { withDate?: boolean } = {}) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    ...(opts.withDate ? { month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}
function fmtDate(iso: string | Date, timeZone: string) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(d);
}
function dayKey(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function CheckInsClient({
  scope,
  kisiConfigured,
  canManage,
  lastSyncAt,
}: {
  scope: CheckInsScope;
  kisiConfigured: boolean;
  canManage: boolean;
  lastSyncAt: string | null;
}) {
  const { toast } = useToast();
  const [range, setRange] = React.useState<Range>("30d");
  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [overview, setOverview] = React.useState<Overview | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [expandedLoc, setExpandedLoc] = React.useState<string | null>(null);
  const [byMember, setByMember] = React.useState<Record<string, ByMember | "loading">>({});
  const [memberFilter, setMemberFilter] = React.useState<Member | null>(null);
  const [daily, setDaily] = React.useState<Daily | null>(null);
  const [dayFilter, setDayFilter] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const locParam = scope.kind === "location" ? `&locationId=${encodeURIComponent(scope.locationId)}` : "";

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const qs = `range=${range}${locParam}${debouncedQ ? `&q=${encodeURIComponent(debouncedQ)}` : ""}${
        memberFilter ? `&memberId=${encodeURIComponent(memberFilter.id)}` : ""
      }${dayFilter ? `&day=${dayFilter}` : ""}&limit=${dayFilter ? 500 : 200}`;
      const [ov, list] = await Promise.all([
        fetch(`/api/admin/check-ins?range=${range}&view=overview`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/admin/check-ins?${qs}`, { cache: "no-store" }).then((r) => r.json()),
      ]);
      setOverview(ov.overview ?? null);
      setRows(list.rows ?? []);
      setTotal(list.total ?? 0);
    } catch {
      toast({ tone: "error", title: "Couldn't load check-ins" });
    } finally {
      setLoading(false);
    }
  }, [range, locParam, debouncedQ, memberFilter, dayFilter, toast]);

  const loadDaily = React.useCallback(async () => {
    const r = await fetch(`/api/admin/check-ins?view=daily&days=30${locParam}`, { cache: "no-store" }).then((r) => r.json());
    setDaily(r.daily ?? null);
  }, [locParam]);

  React.useEffect(() => {
    void loadDaily();
  }, [loadDaily]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function loadByMember(locationId: string) {
    setByMember((m) => ({ ...m, [locationId]: "loading" }));
    const r = await fetch(`/api/admin/check-ins?range=${range}&view=by-member&locationId=${encodeURIComponent(locationId)}`, {
      cache: "no-store",
    }).then((r) => r.json());
    setByMember((m) => ({ ...m, [locationId]: r.rows ?? [] }));
  }

  function toggleLoc(locationId: string) {
    const next = expandedLoc === locationId ? null : locationId;
    setExpandedLoc(next);
    if (next && !byMember[next]) void loadByMember(next);
  }

  React.useEffect(() => {
    // Range changed: drop cached by-member lists.
    setByMember({});
    if (expandedLoc) void loadByMember(expandedLoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/check-ins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      toast({
        tone: "success",
        title: "Synced with Kisi",
        description: data.skipped ? "Kisi not configured" : `${data.fetched} unlocks fetched · ${data.ingested} check-ins`,
      });
      await Promise.all([load(), loadDaily()]);
    } catch (e) {
      toast({ tone: "error", title: "Sync failed", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSyncing(false);
    }
  }

  // Location-scoped stats
  const locStats =
    scope.kind === "location" ? overview?.byLocation.find((b) => b.location.id === scope.locationId) ?? null : null;

  const kpis =
    scope.kind === "org"
      ? [
          { label: "Total check-ins", value: overview?.total ?? "—", hint: `${RANGE_LABEL[range]} · repeat opens within 2 hrs count once` },
          { label: "Usage", value: overview?.uniqueMembers ?? "—", hint: "Members who checked in (grouped by member)" },
          { label: "Matched to members", value: overview?.matched ?? "—", hint: "Kisi email ↔ member email" },
          { label: "Unmatched unlocks", value: overview?.unmatched ?? "—", hint: "Guests / no member with that email" },
        ]
      : [
          { label: "Total check-ins", value: locStats?.total ?? "—", hint: `${RANGE_LABEL[range]} · repeat opens within 2 hrs count once` },
          { label: "Usage", value: locStats?.uniqueMembers ?? "—", hint: "Members who checked in (grouped by member)" },
          { label: "Today", value: locStats?.today ?? "—", hint: "Since midnight" },
          { label: "Unmatched unlocks", value: locStats ? locStats.total - locStats.matched : "—", hint: "Guests / no member with that email" },
        ];

  // Group feed by day (in the row's location timezone)
  const groups = React.useMemo(() => {
    const out: Array<{ key: string; label: string; rows: Row[] }> = [];
    for (const r of rows) {
      const tz = r.location.timezone;
      const key = dayKey(r.enteredAt, tz);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(r);
      else out.push({ key, label: fmtDate(r.enteredAt, tz), rows: [r] });
    }
    return out;
  }, [rows]);

  return (
    <div className="space-y-6">
      {!kisiConfigured && (
        <Card className="border border-apple-orange/30 bg-apple-orange/5">
          <CardHeader
            title="Kisi isn't connected yet"
            subtitle="Add KISI_API_KEY to the server environment. Door unlocks are then pulled every 5 minutes (and instantly if a Kisi webhook is pointed at /api/webhooks/kisi)."
            action={
              canManage ? (
                <Link href={adminRoutes.doorAccess()} className="text-apple-sm font-medium text-apple-blue hover:underline">
                  Door Access →
                </Link>
              ) : undefined
            }
          />
        </Card>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-apple-sm border border-apple-border bg-white p-0.5">
          {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={[
                "rounded-[6px] px-3 py-1.5 text-apple-xs font-medium transition-colors",
                range === r ? "bg-apple-blue text-white" : "text-apple-text-secondary hover:bg-apple-fill-secondary",
              ].join(" ")}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {lastSyncAt && (
            <span className="text-apple-xs text-apple-text-tertiary">
              Last Kisi sync {new Date(lastSyncAt).toLocaleString()}
            </span>
          )}
          {canManage && kisiConfigured && (
            <Button variant="secondary" size="sm" loading={syncing} onClick={syncNow} iconLeft={<RefreshCw className="h-3.5 w-3.5" />}>
              Sync now
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} hint={k.hint} />
        ))}
      </div>

      <Card>
        <CardHeader
          title="Daily check-ins · last 30 days"
          subtitle={
            dayFilter
              ? `Showing ${dayLabel(dayFilter, { long: true })} in the list below.`
              : scope.kind === "org"
                ? "Total check-ins per day at each location. Click a day to see everyone who checked in."
                : "Total check-ins per day. Click a day to see everyone who checked in."
          }
          action={
            dayFilter ? (
              <Button variant="secondary" size="sm" onClick={() => setDayFilter(null)}>
                Clear day
              </Button>
            ) : undefined
          }
        />
        <div className="mt-4">
          {daily ? (
            <BarChart
              data={daily.rows}
              xKey="day"
              series={daily.locations.map((l, i) => ({ key: l.id, label: l.name, color: SERIES_COLORS[i % SERIES_COLORS.length] }))}
              height={260}
              showLegend={daily.locations.length > 1}
              onBarClick={(row) => setDayFilter((cur) => (cur === row.day ? null : String(row.day)))}
              activeX={dayFilter}
              xTickFormatter={(v) => dayLabel(String(v))}
              tooltipLabelFormatter={(v) => dayLabel(String(v), { long: true })}
            />
          ) : (
            <div className="h-[260px] animate-pulse rounded-apple bg-apple-fill-secondary" />
          )}
        </div>
      </Card>

      {scope.kind === "org" && (
        <Card padded={false}>
          <div className="px-5 pt-5">
            <CardHeader title="Check-ins by location" subtitle="Expand a location to see which members checked in (usage)." />
          </div>
          <div className="mt-4 divide-y divide-apple-divider border-t border-apple-divider">
            {(overview?.byLocation ?? []).map((b) => {
              const open = expandedLoc === b.location.id;
              const list = byMember[b.location.id];
              return (
                <div key={b.location.id}>
                  <button
                    type="button"
                    onClick={() => toggleLoc(b.location.id)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-apple-fill-secondary/60"
                  >
                    {open ? <ChevronDown className="h-4 w-4 text-apple-text-tertiary" /> : <ChevronRight className="h-4 w-4 text-apple-text-tertiary" />}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-apple-text">{b.location.name}</div>
                      <div className="text-apple-xs text-apple-text-tertiary">
                        Usage: {b.uniqueMembers} member{b.uniqueMembers === 1 ? "" : "s"} · {b.today} today
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-apple-lg font-semibold tabular-nums text-apple-text">{b.total}</div>
                      <div className="text-apple-xs text-apple-text-tertiary">{b.matched} matched</div>
                    </div>
                    <Link
                      href={adminRoutes.loc.checkIns(b.location.slug)}
                      onClick={(e) => e.stopPropagation()}
                      className="ml-2 hidden text-apple-xs font-medium text-apple-blue hover:underline sm:inline"
                    >
                      Open
                    </Link>
                  </button>
                  {open && (
                    <div className="bg-apple-fill-secondary/40 px-5 py-3 pl-12">
                      {list === "loading" || !list ? (
                        <div className="text-apple-sm text-apple-text-tertiary">Loading…</div>
                      ) : list.length === 0 ? (
                        <div className="text-apple-sm text-apple-text-tertiary">No matched members in this range.</div>
                      ) : (
                        <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                          {list.map((m) => (
                            <li key={m.member.id} className="flex items-center justify-between gap-2 py-1 text-apple-sm">
                              <Link
                                href={adminRoutes.loc.members.detail(b.location.slug, m.member.id)}
                                className="truncate text-apple-text hover:text-apple-blue hover:underline"
                              >
                                {m.member.firstName} {m.member.lastName}
                              </Link>
                              <span className="shrink-0 tabular-nums text-apple-text-tertiary">
                                {m.count}× {m.lastAt ? `· ${new Date(m.lastAt).toLocaleDateString()}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {overview && overview.byLocation.length === 0 && (
              <div className="px-5 py-6 text-apple-sm text-apple-text-tertiary">No locations.</div>
            )}
          </div>
        </Card>
      )}

      {scope.kind === "location" && (
        <MembersWhoCheckedIn
          scope={scope}
          range={range}
          selected={memberFilter}
          onSelect={(m) => setMemberFilter((cur) => (cur?.id === m.id ? null : m))}
        />
      )}

      <Card padded={false}>
        <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <CardHeader
            title={
              memberFilter
                ? `${memberFilter.firstName} ${memberFilter.lastName}`
                : dayFilter
                  ? `Check-ins on ${dayLabel(dayFilter, { long: true })}`
                  : "Door unlocks"
            }
            subtitle={
              memberFilter
                ? `${total} check-in${total === 1 ? "" : "s"} · `
                : `${total} check-in${total === 1 ? "" : "s"} ${dayFilter ? "that day" : `in ${RANGE_LABEL[range].toLowerCase()}`} · exact unlock time${
                    scope.kind === "org" ? " and location" : ""
                  }`
            }
          >
            {memberFilter && (
              <button type="button" onClick={() => setMemberFilter(null)} className="text-apple-sm text-apple-blue hover:underline">
                Show everyone
              </button>
            )}
            {!memberFilter && dayFilter && (
              <button type="button" onClick={() => setDayFilter(null)} className="text-apple-sm text-apple-blue hover:underline">
                Back to {RANGE_LABEL[range].toLowerCase()}
              </button>
            )}
          </CardHeader>
          <div className="w-full sm:w-72">
            <Input
              placeholder="Search name or email"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              prefix={<Search className="h-4 w-4" />}
            />
          </div>
        </div>

        <div className="mt-4 border-t border-apple-divider">
          {loading && rows.length === 0 ? (
            <div className="px-5 py-10 text-center text-apple-sm text-apple-text-tertiary">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<DoorOpen className="h-6 w-6" />}
                title="No check-ins yet"
                description={
                  kisiConfigured
                    ? "Unlocks will appear here within a few minutes of a member opening a door."
                    : "Connect Kisi under Door Access to start tracking door unlocks as check-ins."
                }
              />
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.key}>
                <div className="sticky top-0 z-[1] bg-apple-fill-secondary/80 px-5 py-1.5 text-apple-xs font-medium uppercase tracking-wide text-apple-text-tertiary backdrop-blur">
                  {g.label}
                </div>
                <ul className="divide-y divide-apple-divider">
                  {g.rows.map((r) => (
                    <CheckInRow key={r.id} row={r} showLocation={scope.kind === "org"} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
        {rows.length > 0 && rows.length < total && (
          <div className="border-t border-apple-divider px-5 py-3 text-center text-apple-xs text-apple-text-tertiary">
            Showing the latest {rows.length} of {total}. Narrow the range or search to see more.
          </div>
        )}
      </Card>
    </div>
  );
}

function CheckInRow({ row, showLocation }: { row: Row; showLocation: boolean }) {
  const tz = row.location.timezone;
  const name = row.member ? `${row.member.firstName} ${row.member.lastName}`.trim() : null;
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <div className="w-[88px] shrink-0 text-apple-sm font-semibold tabular-nums text-apple-text">{fmtTime(row.enteredAt, tz)}</div>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-fill-secondary text-apple-text-tertiary">
        <UserRound className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {row.member ? (
            <Link
              href={adminRoutes.loc.members.detail(row.location.slug, row.member.id)}
              className="truncate font-medium text-apple-text hover:text-apple-blue hover:underline"
            >
              {name}
            </Link>
          ) : (
            <span className="truncate font-medium text-apple-text-secondary">
              {row.guestName ?? row.actorEmail ?? "Unknown Kisi user"}
            </span>
          )}
          {!row.member && (
            <Badge tone="warn" size="sm">
              {row.guestName ? "Guest · not a member" : "Unmatched"}
            </Badge>
          )}
          {row.type === "RESERVATION" && <Badge tone="info" size="sm">Reservation</Badge>}
          {row.unlockCount > 1 && (
            <Badge tone="muted" size="sm">
              {row.unlockCount} unlocks{row.lastUnlockAt ? ` · last ${fmtTime(row.lastUnlockAt, tz)}` : ""}
            </Badge>
          )}
        </div>
        <div className="truncate text-apple-xs text-apple-text-tertiary">
          {[showLocation ? row.location.name : null, row.door?.name ?? "Door", row.member?.email ?? (row.guestName ? row.actorEmail : null)]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
    </li>
  );
}

function MembersWhoCheckedIn({
  scope,
  range,
  selected,
  onSelect,
}: {
  scope: Extract<CheckInsScope, { kind: "location" }>;
  range: Range;
  selected: Member | null;
  onSelect: (m: Member) => void;
}) {
  const [list, setList] = React.useState<ByMember | null>(null);
  const [open, setOpen] = React.useState(true);
  React.useEffect(() => {
    let alive = true;
    setList(null);
    fetch(`/api/admin/check-ins?range=${range}&view=by-member&locationId=${encodeURIComponent(scope.locationId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => alive && setList(d.rows ?? []))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [range, scope.locationId]);

  return (
    <Card padded={false}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        {open ? <ChevronDown className="h-4 w-4 text-apple-text-tertiary" /> : <ChevronRight className="h-4 w-4 text-apple-text-tertiary" />}
        <div className="flex-1">
          <h2 className="text-apple-lg font-semibold text-apple-text">Members who checked in</h2>
          <p className="text-apple-sm text-apple-text-secondary">
            {list ? `${list.length} member${list.length === 1 ? "" : "s"} in ${RANGE_LABEL[range].toLowerCase()}` : "Loading…"} · tap a member to
            filter the unlock list
          </p>
        </div>
      </button>
      {open && list && list.length > 0 && (
        <ul className="grid grid-cols-1 gap-px border-t border-apple-divider bg-apple-divider sm:grid-cols-2 lg:grid-cols-3">
          {list.map((m) => {
            const active = selected?.id === m.member.id;
            return (
              <li key={m.member.id} className="bg-white">
                <button
                  type="button"
                  onClick={() => onSelect(m.member)}
                  className={[
                    "flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-apple-fill-secondary/60",
                    active ? "bg-apple-blue/5" : "",
                  ].join(" ")}
                >
                  <div className="min-w-0">
                    <div className="truncate text-apple-sm font-medium text-apple-text">
                      {m.member.firstName} {m.member.lastName}
                    </div>
                    <div className="truncate text-apple-xs text-apple-text-tertiary">
                      {m.lastAt ? `Last ${fmtTime(m.lastAt, scope.timezone, { withDate: true })}` : ""}
                    </div>
                  </div>
                  <Badge tone={active ? "info" : "muted"}>{m.count}×</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && list && list.length === 0 && (
        <div className="border-t border-apple-divider px-5 py-6 text-apple-sm text-apple-text-tertiary">No matched members in this range.</div>
      )}
    </Card>
  );
}
