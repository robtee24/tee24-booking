// app/schedule/page.tsx
"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type BayCol = { id: string; number: number; name: string | null };
type BookingDTO = {
  id: string;
  bayNumber: number;
  start: string;
  end: string;
  firstName: string;
  lastName: string;
};
type ApiOk = {
  locationName: string;
  locationSlug: string;
  dateISO: string;
  bays: BayCol[];
  bookings: BookingDTO[];
};
type ApiErr = { error: string };

const HOUR_PX = 96;
const DAY_PX = 24 * HOUR_PX;

function nyISO(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function coerceDay(iso?: string | null) {
  const today = nyISO();
  if (!iso) return today;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : today;
}
function shiftISO(baseISO: string, offsetDays: number) {
  const d = new Date(`${baseISO}T00:00:00`);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function fmtLongDateNY(iso: string) {
  const d = new Date(`${iso}T12:00:00-05:00`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}
function fmtTimeNY(d: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
function fmtHourLabel(h: number) {
  const base = new Date(`2000-01-01T${String(h).padStart(2, "0")}:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(base);
}
function nameCompact(fn: string, ln: string) {
  const first = (fn || "").trim();
  const last = (ln || "").trim();
  return `${first ? first[0] + "." : ""} ${last}`.trim();
}

export default function LocationSchedulePage() {
  return (
    <Suspense fallback={<ScheduleFallback />}>
      <ScheduleInner />
    </Suspense>
  );
}

function ScheduleFallback() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-apple-xl font-semibold text-apple-text mb-2">Location schedule</h1>
      <p className="text-apple-sm text-apple-text-secondary">Loading…</p>
    </main>
  );
}

function ScheduleInner() {
  const sp = useSearchParams() as URLSearchParams | null;
  const slug = (sp?.get("slug") ?? "").trim();
  const dParam = coerceDay(sp?.get("d") ?? null);

  const [data, setData] = useState<ApiOk | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [raw, setRaw] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const mkUrl = (d: string) => `/schedule?slug=${encodeURIComponent(slug)}&d=${d}`;
  const prevISO = shiftISO(dParam, -1);
  const nextISO = shiftISO(dParam, +1);
  const todayISO = nyISO();

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      setRaw(null);
      setData(null);
      try {
        const url = `/schedule-data?slug=${encodeURIComponent(slug)}&d=${encodeURIComponent(dParam)}`;
        const res = await fetch(url, { cache: "no-store" });

        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          const text = await res.text();
          if (!cancelled) {
            setRaw(text.slice(0, 5000));
            setErr(`Unexpected response (status ${res.status}).`);
          }
          return;
        }

        const json = (await res.json()) as ApiOk | ApiErr;
        if (!res.ok || (json as ApiErr).error) {
          throw new Error((json as ApiErr).error || `HTTP ${res.status}`);
        }
        if (!cancelled) setData(json as ApiOk);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug, dParam]);

  const columns = useMemo(() => {
    if (!data) {
      return {
        bays: [] as BayCol[],
        cols: {} as Record<number, { id: string; topPx: number; heightPx: number; name: string; times: string }[]>,
      };
    }

    const minutesPerDay = 24 * 60;
    const startNY = new Date(`${data.dateISO}T00:00:00-05:00`);

    const grouped: Record<number, BookingDTO[]> = {};
    for (const b of data.bookings) {
      grouped[b.bayNumber] ||= [];
      grouped[b.bayNumber].push(b);
    }

    const cols: Record<number, { id: string; topPx: number; heightPx: number; name: string; times: string }[]> = {};
    for (const bay of data.bays) {
      const list = (grouped[bay.number] || []).map((b) => {
        const s = new Date(b.start);
        const e = new Date(b.end);
        const startMin = Math.max(0, Math.round((s.getTime() - startNY.getTime()) / 60000));
        const endMin = Math.min(minutesPerDay, Math.round((e.getTime() - startNY.getTime()) / 60000));
        const topPx = (startMin / minutesPerDay) * DAY_PX;
        const heightPx = Math.max(28, ((endMin - startMin) / minutesPerDay) * DAY_PX);
        return {
          id: b.id,
          topPx,
          heightPx,
          name: nameCompact(b.firstName, b.lastName),
          times: `${fmtTimeNY(s)}–${fmtTimeNY(e)}`
        };
      });
      cols[bay.number] = list;
    }

    return { bays: data.bays, cols };
  }, [data]);

  const palette = [
    ["bg-blue-50", "border-blue-200/60", "text-blue-900"],
    ["bg-emerald-50", "border-emerald-200/60", "text-emerald-900"],
    ["bg-amber-50", "border-amber-200/60", "text-amber-900"],
    ["bg-violet-50", "border-violet-200/60", "text-violet-900"],
    ["bg-rose-50", "border-rose-200/60", "text-rose-900"],
    ["bg-cyan-50", "border-cyan-200/60", "text-cyan-900"],
    ["bg-fuchsia-50", "border-fuchsia-200/60", "text-fuchsia-900"],
    ["bg-lime-50", "border-lime-200/60", "text-lime-900"],
    ["bg-orange-50", "border-orange-200/60", "text-orange-900"],
    ["bg-sky-50", "border-sky-200/60", "text-sky-900"],
  ];

  useEffect(() => {
    if (!data || data.dateISO !== todayISO) return;
    const el = containerRef.current;
    if (!el) return;

    const scrollToNow = () => {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      const topPx = (minutes / (24 * 60)) * DAY_PX;
      const gridRect = el.getBoundingClientRect();
      const scrollTarget = window.scrollY + gridRect.top + topPx - 120;
      window.scrollTo({ top: Math.max(0, scrollTarget), behavior: "instant" as ScrollBehavior });
    };

    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(scrollToNow);
    } else {
      setTimeout(scrollToNow, 0);
    }
  }, [data, todayISO]);

  if (!slug) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-apple-xl font-semibold text-apple-text mb-2">Location schedule</h1>
        <p className="text-apple-sm text-apple-text-secondary">
          Add <code className="rounded-apple-sm bg-apple-fill-secondary px-1.5 py-0.5 font-mono text-apple-xs">?slug=&lt;locationSlug&gt;</code> to the URL.
        </p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-apple-bg">
      <div className="px-[5%] sm:px-[10%] pt-6 pb-24">
        {/* Top */}
        <div className="pb-2 text-apple-2xl font-semibold tracking-tight text-apple-text">
          {data ? data.locationName : "Loading…"}
        </div>

        <header className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-apple-divider">
          <div className="text-apple-lg font-medium text-apple-text">All Bays</div>
          <div className="flex items-center gap-2">
            <Link href={mkUrl(prevISO)} className="btn-secondary !px-3 !py-1.5 text-apple-sm">←</Link>
            <div className="px-2 text-apple-base font-semibold text-apple-text">{data ? fmtLongDateNY(data.dateISO) : fmtLongDateNY(dParam)}</div>
            <Link href={mkUrl(nextISO)} className="btn-secondary !px-3 !py-1.5 text-apple-sm">→</Link>
            <Link href={mkUrl(todayISO)} className="btn-secondary !px-3 !py-1.5 text-apple-sm ml-1">Today</Link>
          </div>
        </header>

        {/* Calendar */}
        {loading ? (
          <div className="mt-6 text-apple-sm text-apple-text-tertiary">Loading…</div>
        ) : err ? (
          <div className="mt-6 rounded-apple-sm border border-apple-orange/30 bg-apple-orange/5 p-4 text-apple-sm text-apple-orange">
            <div className="font-medium mb-1">Couldn&apos;t load schedule</div>
            <div>{err}</div>
            {raw ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-apple-xs">Show server response</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words text-apple-xs bg-white border border-apple-border p-2 rounded-apple-sm max-h-64 overflow-auto">{raw}</pre>
              </details>
            ) : null}
          </div>
        ) : !data ? (
          <div className="mt-6 card p-4 text-apple-sm text-apple-text-secondary">No data.</div>
        ) : (
          <section className="mt-4 rounded-apple shadow-apple overflow-x-auto">
            <div
              ref={containerRef}
              className="bg-white"
              style={{ minWidth: `${80 + data.bays.length * 180}px` }}
            >
              <div
                className="grid w-full relative"
                style={{ gridTemplateColumns: `80px repeat(${data.bays.length}, minmax(180px, 1fr))`, height: DAY_PX }}
              >
                {/* Ruler */}
                <div className="bg-apple-fill-secondary border-r border-apple-divider text-apple-xs text-apple-text-tertiary">
                  {Array.from({ length: 24 }).map((_, h) => (
                    <div key={h} className="h-24 px-2 flex items-start border-t border-apple-divider/50">{fmtHourLabel(h)}</div>
                  ))}
                  <div className="border-t border-apple-divider/50" />
                </div>

                {/* Bay columns */}
                {data.bays.map((bay) => {
                  const list = columns.cols[bay.number] || [];
                  return (
                    <div key={bay.id} className="relative border-l border-apple-divider">
                      <div className="sticky top-0 left-0 right-0 h-8 bg-white/90 backdrop-blur-sm border-b border-apple-divider flex items-center px-3 text-apple-xs font-medium text-apple-text z-10">
                        Bay {bay.name ?? bay.number}
                      </div>

                      {Array.from({ length: 24 }).map((_, h) => (
                        <div key={h} className="absolute left-0 right-0 border-t border-apple-divider/30" style={{ top: `${(h / 24) * 100}%` }} />
                      ))}
                      <div className="absolute left-0 right-0 border-t border-apple-divider/30" style={{ top: "100%" }} />

                      {list.map((blk, idx) => {
                        const [bg, br, tx] = palette[idx % palette.length];
                        return (
                          <div
                            key={blk.id}
                            className={`absolute left-1 right-1 rounded-apple-sm border shadow-apple px-2 py-1 ${bg} ${br} ${tx}`}
                            style={{ top: blk.topPx, height: blk.heightPx, minHeight: 28 }}
                          >
                            <div className="text-[11px] leading-tight font-medium truncate">{blk.name}</div>
                            <div className="text-[10px] leading-tight opacity-70">{blk.times}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Floating Reserve button */}
      {data?.locationSlug ? (
        <div className="fixed bottom-5 left-[5%] sm:left-[10%] right-[5%] sm:right-[10%] z-50 pointer-events-none">
          <Link
            href={`/book/${data.locationSlug}`}
            aria-label={`Reserve a bay at ${data.locationName}`}
            className="pointer-events-auto btn-primary block w-full text-center !py-3.5 shadow-apple-lg"
          >
            Reserve A Bay
          </Link>
        </div>
      ) : null}
    </div>
  );
}
