// app/bay/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type BookingDTO = {
  id: string;
  start: string;
  end: string;
  firstName: string;
  lastName: string;
};
type BayDTO = { id: string; number: number; name: string | null; locationId: string };

type ApiOk = {
  bay: BayDTO;
  locationName: string;
  locationSlug: string;
  dateISO: string;
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
function fmtTimeNY(d: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
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
function fmtHourLabel(h: number) {
  const base = new Date(`2000-01-01T${String(h).padStart(2, "0")}:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(base);
}

export default function BayCalendarPage() {
  const sp = useSearchParams();
  const id = sp.get("id")?.trim() || "";
  const dParam = coerceDay(sp.get("d"));

  const [data, setData] = useState<ApiOk | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [raw, setRaw] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const mkUrl = (d: string) => `/bay?id=${encodeURIComponent(id)}&d=${d}`;
  const prevISO = shiftISO(dParam, -1);
  const nextISO = shiftISO(dParam, +1);
  const todayISO = nyISO();

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      setRaw(null);
      setData(null);
      try {
        const url = `/bay-data?id=${encodeURIComponent(id)}&d=${encodeURIComponent(dParam)}`;
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
        if (!res.ok || (json as ApiErr).error)
          throw new Error((json as ApiErr).error || `HTTP ${res.status}`);
        if (!cancelled) setData(json as ApiOk);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, dParam]);

  const { blocks, isTodayNY } = useMemo(() => {
    if (!data)
      return { blocks: [] as { id: string; topPx: number; heightPx: number; label: string }[], isTodayNY: false };
    const minutesPerDay = 24 * 60;
    const startNY = new Date(`${data.dateISO}T00:00:00-05:00`);
    const blocks = data.bookings.map((b) => {
      const s = new Date(b.start);
      const e = new Date(b.end);
      const startMin = Math.max(0, Math.round((s.getTime() - startNY.getTime()) / 60000));
      const endMin = Math.min(minutesPerDay, Math.round((e.getTime() - startNY.getTime()) / 60000));
      const topPx = (startMin / minutesPerDay) * DAY_PX;
      const heightPx = Math.max(32, ((endMin - startMin) / minutesPerDay) * DAY_PX);
      const label = `${b.firstName} ${b.lastName} • ${fmtTimeNY(s)}–${fmtTimeNY(e)}`;
      return { id: b.id, topPx, heightPx, label };
    });
    const isTodayNY = data.dateISO === nyISO();
    return { blocks, isTodayNY };
  }, [data]);

  useEffect(() => {
    if (!isTodayNY) return;
    const el = containerRef.current;
    if (!el) return;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const topPx = (minutes / (24 * 60)) * DAY_PX;
    el.scrollTo({ top: Math.max(0, topPx - 60), behavior: "instant" as ScrollBehavior });
  }, [isTodayNY, data?.dateISO]);

  const colorClasses = [
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

  if (!id) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-semibold mb-2">Bay calendar (read-only)</h1>
        <p className="text-sm text-gray-700">
          Add <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">?id=&lt;bayId&gt;</code> to the URL.
        </p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <main className="flex-1 flex flex-col px-[5%] sm:px-[10%] pb-0">
        <div className="pb-2 text-2xl font-semibold">
          {data ? data.locationName : "Loading…"}
        </div>

        <header className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b">
          <div className="text-lg font-medium">
            {data ? <>Bay {data.bay.name ?? data.bay.number}</> : <>Bay</>}
          </div>

          <div className="flex items-center gap-2">
            <Link href={mkUrl(prevISO)} className="px-3 py-1.5 rounded border hover:bg-gray-50">←</Link>
            <div className="px-2 text-base font-semibold">
              {data ? fmtLongDateNY(data.dateISO) : fmtLongDateNY(dParam)}
            </div>
            <Link href={mkUrl(nextISO)} className="px-3 py-1.5 rounded border hover:bg-gray-50">→</Link>
            <Link href={mkUrl(todayISO)} className="ml-2 px-3 py-1.5 rounded border hover:bg-gray-50">Today</Link>
          </div>
        </header>

        <section className="relative mt-4 border rounded-lg overflow-hidden flex-1 min-h-0">
          <div ref={containerRef} className="relative flex-1 min-h-0 overflow-auto bg-white">
            <div className="grid grid-cols-[80px_1fr] w-full relative" style={{ height: DAY_PX }}>
              <div className="bg-gray-50 border-r text-xs text-gray-600">
                {Array.from({ length: 24 }).map((_, h) => (
                  <div key={h} className="h-24 px-2 flex items-start border-t border-gray-100">
                    {fmtHourLabel(h)}
                  </div>
                ))}
                <div className="border-t border-gray-100" />
              </div>
              <div className="relative">
                {Array.from({ length: 24 }).map((_, h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-gray-100"
                    style={{ top: `${(h / 24) * 100}%` }}
                  />
                ))}
                {blocks.map((blk, i) => {
                  const [bg, br, tx] = colorClasses[i % colorClasses.length];
                  return (
                    <div
                      key={blk.id}
                      className={`absolute left-2 right-2 rounded-md border shadow-sm text-sm px-2 py-1 flex items-center ${bg} ${br} ${tx}`}
                      style={{ top: blk.topPx, height: blk.heightPx, minHeight: 32 }}
                    >
                      {blk.label}
                    </div>
                  );
                })}
                <div style={{ height: 180 }} />
              </div>
            </div>
          </div>
        </section>
      </main>

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





