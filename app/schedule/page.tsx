// app/schedule/page.tsx
"use client";

/**
 * Location-wide read-only day view with bay columns
 * URL: /schedule?slug=<locationSlug>&d=YYYY-MM-DD
 *
 * - Left hour ruler; each bay is its own column
 * - Blocks show: "F. Lastname" (top) and times (below, small)
 * - Full-width blocks per column
 * - Autoscrolls so "now" is at the very top when viewing today's date
 * - Full-height layout with responsive margins (5% mobile, 10% tablet/desktop)
 * - Floating full-width "Reserve A Bay" button at bottom (inside margins)
 * - Per-column color cycling: each column alternates through 10 colors independently
 * - No bottom gap; grid extends to 12:00 AM (explicit bottom line)
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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

const HOUR_PX = 96;           // 6rem
const DAY_PX = 24 * HOUR_PX;  // total pixel height for 24h

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
  const sp = useSearchParams();
  const slug = sp.get("slug")?.trim() || "";
  const dParam = coerceDay(sp.get("d"));

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

  // Build columns with bookings positioned by time
  const columns = useMemo(() => {
    if (!data) {
      return {
        bays: [] as BayCol[],
        cols: {} as Record<number, { id: string; topPx: number; heightPx: number; name: string; times: string }[]>,
      };
    }

    const minutesPerDay = 24 * 60;
    const startNY = new Date(`${data.dateISO}T00:00:00-05:00`);

    // Group bookings by bayNumber
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

  // 10-color palette
  const palette = [
    ["bg-blue-50", "border-blue-200", "text-blue-900"],
    ["bg-emerald-50", "border-emerald-200", "text-emerald-900"],
    ["bg-amber-50", "border-amber-200", "text-amber-900"],
    ["bg-violet-50", "border-violet-200", "text-violet-900"],
    ["bg-rose-50", "border-rose-200", "text-rose-900"],
    ["bg-cyan-50", "border-cyan-200", "text-cyan-900"],
    ["bg-fuchsia-50", "border-fuchsia-200", "text-fuchsia-900"],
    ["bg-lime-50", "border-lime-200", "text-lime-900"],
    ["bg-orange-50", "border-orange-200", "text-orange-900"],
    ["bg-sky-50", "border-sky-200", "text-sky-900"],
  ];

  // Auto-scroll so "now" sits at the top on today's date
  useEffect(() => {
    if (!data || data.dateISO !== todayISO) return;
    const el = containerRef.current;
    if (!el) return;

    const scrollToNow = () => {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      const topPx = (minutes / (24 * 60)) * DAY_PX;
      el.scrollTo({ top: Math.max(0, topPx), behavior: "instant" as ScrollBehavior });
    };

    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(scrollToNow);
    } else {
      setTimeout(scrollToNow, 0);
    }
  }, [data, todayISO]);

  if (!slug) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-semibold mb-2">Location schedule (read-only)</h1>
        <p className="text-sm text-gray-700">
          Add <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">?slug=&lt;locationSlug&gt;</code> to the URL.
        </p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <main className="flex-1 flex flex-col px-[5%] sm:px-[10%] pb-0">
        {/* Top */}
        <div className="pb-2 text-2xl font-semibold">{data ? data.locationName : "Loading…"}</div>

        <header className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b">
          <div className="text-lg font-medium">All Bays</div>
          <div className="flex items-center gap-2">
            <Link href={mkUrl(prevISO)} className="px-3 py-1.5 rounded border hover:bg-gray-50">←</Link>
            <div className="px-2 text-base font-semibold">{data ? fmtLongDateNY(data.dateISO) : fmtLongDateNY(dParam)}</div>
            <Link href={mkUrl(nextISO)} className="px-3 py-1.5 rounded border hover:bg-gray-50">→</Link>
            <Link href={mkUrl(todayISO)} className="ml-2 px-3 py-1.5 rounded border hover:bg-gray-50">Today</Link>
          </div>
        </header>

        {/* Calendar */}
        {loading ? (
          <div className="mt-6 text-sm text-gray-600">Loading…</div>
        ) : err ? (
          <div className="mt-6 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
            <div className="font-medium mb-1">Couldn’t load schedule</div>
            <div>{err}</div>
            {raw ? (
              <details className="mt-2">
                <summary className="cursor-pointer">Show server response</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words text-xs bg-white border p-2 rounded max-h-64 overflow-auto">{raw}</pre>
              </details>
            ) : null}
          </div>
        ) : !data ? (
          <div className="mt-6 rounded border bg-gray-50 p-3 text-sm">No data.</div>
        ) : (
          <section className="relative mt-4 border rounded-lg overflow-hidden flex-1 min-h-0">
            <div ref={containerRef} className="relative flex-1 min-h-0 overflow-auto bg-white">
              {/* Grid: 80px ruler + N bay columns; bay columns min width for readability */}
              <div
                className="grid w-full relative"
                style={{ gridTemplateColumns: `80px repeat(${data.bays.length}, minmax(180px, 1fr))`, height: DAY_PX }}
              >
                {/* Ruler */}
                <div className="bg-gray-50 border-r text-xs text-gray-600">
                  {Array.from({ length: 24 }).map((_, h) => (
                    <div key={h} className="h-24 px-2 flex items-start border-t border-gray-100">{fmtHourLabel(h)}</div>
                  ))}
                  {/* explicit midnight line to close the day */}
                  <div className="border-t border-gray-100" />
                </div>

                {/* Bay columns */}
                {data.bays.map((bay) => {
                  const list = columns.cols[bay.number] || [];
                  return (
                    <div key={bay.id} className="relative border-l">
                      {/* Column header (overlay) */}
                      <div className="absolute left-0 right-0 top-0 h-8 bg-white/90 backdrop-blur-sm border-b flex items-center px-2 text-xs font-medium z-10">
                        Bay {bay.name ?? bay.number}
                      </div>

                      {/* Hour lines */}
                      {Array.from({ length: 24 }).map((_, h) => (
                        <div
                          key={h}
                          className="absolute left-0 right-0 border-t border-gray-100"
                          style={{ top: `${(h / 24) * 100}%` }}
                        />
                      ))}
                      {/* explicit midnight line at 100% */}
                      <div className="absolute left-0 right-0 border-t border-gray-100" style={{ top: "100%" }} />

                      {/* Bookings — full width & per-column color cycling */}
                      {list.map((blk, idx) => {
                        const [bg, br, tx] = palette[idx % palette.length];
                        return (
                          <div
                            key={blk.id}
                            className={`absolute left-0 right-0 border-y first:rounded-t-md last:rounded-b-md shadow-sm px-2 py-1 ${bg} ${br} ${tx}`}
                            style={{ top: blk.topPx, height: blk.heightPx, minHeight: 28 }}
                          >
                            <div className="text-[11px] leading-tight font-medium truncate">{blk.name}</div>
                            <div className="text-[10px] leading-tight opacity-80">{blk.times}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              {/* No spacer: content now ends exactly at 12:00 AM */}
            </div>
          </section>
        )}
      </main>

      {/* Floating full-width Reserve button (overlay; respects page margins) */}
      {data?.locationSlug ? (
        <div className="fixed bottom-4 left-[5%] sm:left-[10%] right-[5%] sm:right-[10%] z-50 pointer-events-none">
          <Link
            href={`/book/${data.locationSlug}`}
            aria-label={`Reserve a bay at ${data.locationName}`}
            className="pointer-events-auto block w-full text-center rounded-xl bg-black text-white px-5 py-3 text-sm font-medium shadow-lg hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/30"
          >
            Reserve A Bay
          </Link>
        </div>
      ) : null}
    </div>
  );
}


