// app/bay/page.tsx
"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
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
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(d);
}
function fmtLongDateNY(iso: string) {
  const d = new Date(`${iso}T12:00:00-05:00`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "long", day: "numeric" }).format(d);
}
function fmtHourLabel(h: number) {
  const base = new Date(`2000-01-01T${String(h).padStart(2, "0")}:00:00`);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(base);
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="text-apple-xl font-semibold text-apple-text mb-2">Bay calendar</h1>
          <p className="text-apple-sm text-apple-text-secondary">Loading…</p>
        </main>
      }
    >
      <BayCalendarPage />
    </Suspense>
  );
}

function BayCalendarPage() {
  const sp = useSearchParams();
  const id = ((sp && sp.get("id")) || "").trim();
  const dParam = coerceDay(sp?.get("d"));

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
      setLoading(true); setErr(null); setRaw(null); setData(null);
      try {
        const url = `/bay-data?id=${encodeURIComponent(id)}&d=${encodeURIComponent(dParam)}`;
        const res = await fetch(url, { cache: "no-store" });
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          const text = await res.text();
          if (!cancelled) { setRaw(text.slice(0, 5000)); setErr(`Unexpected response (status ${res.status}).`); }
          return;
        }
        const json = (await res.json()) as ApiOk | ApiErr;
        if (!res.ok || (json as ApiErr).error) throw new Error((json as ApiErr).error || `HTTP ${res.status}`);
        if (!cancelled) setData(json as ApiOk);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, dParam]);

  const { blocks, isTodayNY } = useMemo(() => {
    if (!data) return { blocks: [] as { id: string; topPx: number; heightPx: number; label: string }[], isTodayNY: false };
    const minutesPerDay = 24 * 60;
    const startNY = new Date(`${data.dateISO}T00:00:00-05:00`);
    const blocks = data.bookings.map((b) => {
      const s = new Date(b.start);
      const e = new Date(b.end);
      const startMin = Math.max(0, Math.round((s.getTime() - startNY.getTime()) / 60000));
      const endMin = Math.min(minutesPerDay, Math.round((e.getTime() - startNY.getTime()) / 60000));
      const topPx = (startMin / minutesPerDay) * DAY_PX;
      const heightPx = Math.max(32, ((endMin - startMin) / minutesPerDay) * DAY_PX);
      const label = `${b.firstName} ${b.lastName} · ${fmtTimeNY(s)}–${fmtTimeNY(e)}`;
      return { id: b.id, topPx, heightPx, label };
    });
    return { blocks, isTodayNY: data.dateISO === nyISO() };
  }, [data]);

  useEffect(() => {
    if (!isTodayNY) return;
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
  }, [isTodayNY, data?.dateISO]);

  const colorClasses = [
    ["bg-emerald-50", "border-emerald-200/60", "text-emerald-900"],
    ["bg-amber-50", "border-amber-200/60", "text-amber-900"],
    ["bg-violet-50", "border-violet-200/60", "text-violet-900"],
    ["bg-rose-50", "border-rose-200/60", "text-rose-900"],
    ["bg-cyan-50", "border-cyan-200/60", "text-cyan-900"],
    ["bg-fuchsia-50", "border-fuchsia-200/60", "text-fuchsia-900"],
    ["bg-lime-50", "border-lime-200/60", "text-lime-900"],
    ["bg-orange-50", "border-orange-200/60", "text-orange-900"],
    ["bg-sky-50", "border-sky-200/60", "text-sky-900"],
    ["bg-teal-50", "border-teal-200/60", "text-teal-900"],
  ];

  if (!id) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-apple-xl font-semibold text-apple-text mb-2">Bay calendar</h1>
        <p className="text-apple-sm text-apple-text-secondary">
          Add <code className="rounded-apple-sm bg-apple-fill-secondary px-1.5 py-0.5 font-mono text-apple-xs">?id=&lt;bayId&gt;</code> to the URL.
        </p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-apple-bg">
      <div className="px-[5%] sm:px-[10%] pt-6 pb-24">
        <div className="pb-2 text-apple-2xl font-semibold tracking-tight text-apple-text">
          {data ? data.locationName : "Loading…"}
        </div>

        <header className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-apple-divider">
          <div className="text-apple-lg font-medium text-apple-text">
            {data ? <>Bay {data.bay.name ?? data.bay.number}</> : <>Bay</>}
          </div>
          <div className="flex items-center gap-2">
            <Link href={mkUrl(shiftISO(dParam, -1))} className="btn-secondary !px-3 !py-1.5 text-apple-sm">←</Link>
            <div className="px-2 text-apple-base font-semibold text-apple-text">
              {data ? fmtLongDateNY(data.dateISO) : fmtLongDateNY(dParam)}
            </div>
            <Link href={mkUrl(shiftISO(dParam, +1))} className="btn-secondary !px-3 !py-1.5 text-apple-sm">→</Link>
            <Link href={mkUrl(nyISO())} className="btn-secondary !px-3 !py-1.5 text-apple-sm ml-1">Today</Link>
          </div>
        </header>

        <section className="mt-4 rounded-apple shadow-apple overflow-hidden">
          <div ref={containerRef} className="bg-white">
            <div className="grid grid-cols-[80px_1fr] w-full relative" style={{ height: DAY_PX }}>
              <div className="bg-apple-fill-secondary border-r border-apple-divider text-apple-xs text-apple-text-tertiary">
                {Array.from({ length: 24 }).map((_, h) => (
                  <div key={h} className="h-24 px-2 flex items-start border-t border-apple-divider/50">
                    {fmtHourLabel(h)}
                  </div>
                ))}
                <div className="border-t border-apple-divider/50" />
              </div>
              <div className="relative">
                {Array.from({ length: 24 }).map((_, h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-apple-divider/30" style={{ top: `${(h / 24) * 100}%` }} />
                ))}
                {blocks.map((blk, i) => {
                  const [bg, br, tx] = colorClasses[i % colorClasses.length];
                  return (
                    <div
                      key={blk.id}
                      className={`absolute left-2 right-2 rounded-apple-sm border shadow-apple text-apple-sm px-2 py-1 flex items-center ${bg} ${br} ${tx}`}
                      style={{ top: blk.topPx, height: blk.heightPx, minHeight: 32 }}
                    >
                      {blk.label}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </div>

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
