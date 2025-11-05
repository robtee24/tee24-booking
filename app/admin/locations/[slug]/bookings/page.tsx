// app/admin/locations/[slug]/bookings/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

// --- tiny icon stubs (no external deps) ---
const Trash2 = (props: any) => <span {...props}>🗑️</span>;
const ChevronLeft = (props: any) => <span {...props}>←</span>;
const ChevronRight = (props: any) => <span {...props}>→</span>;
const Plus = (props: any) => <span {...props}>＋</span>;

type Bay = { id: string; number: number };
type Booking = {
  id: string;
  bayId: string; // mapped server-side from bayNumber
  locationId: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  start: string | Date;
  end: string | Date;
  note?: string | null;
};

type DayPayload = {
  date: string;
  bays: Bay[];
  bookings: Booking[];
  locationId: string;
  locationName: string;
  minBookingMinutes: number;
};

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const minutesToTop = (m: number, px: number) => Math.round(m * px);

// Build "HH:MM" options across 24h by step minutes
function buildTimeOptions(step: number) {
  const opts: { label: string; value: string }[] = [];
  for (let m = 0; m < 24 * 60; m += step) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    const value = `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    const hour12 = ((h + 11) % 12) + 1;
    const ampm = h < 12 ? "AM" : "PM";
    const label = `${hour12}:${String(mm).padStart(2, "0")} ${ampm}`;
    opts.push({ label, value });
  }
  return opts;
}

// Combine YYYY-MM-DD + "HH:MM" (local) => ISO
function mergeDateAndTimeISO(dateOnlyISO: string, hhmm: string) {
  const [Y, M, D] = [dateOnlyISO.slice(0, 4), dateOnlyISO.slice(5, 7), dateOnlyISO.slice(8, 10)].map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(Number(Y), Number(M) - 1, Number(D), h, m, 0, 0); // local time
  return d.toISOString();
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch {}
    throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  return res.json();
}

// ---------- Overlap helper (client-side guard) ----------
function hasOverlap(
  all: Booking[],
  bayId: string,
  startISO: string,
  endISO: string,
  excludeId?: string
): Booking | null {
  const start = new Date(startISO);
  const end = new Date(endISO);
  for (const b of all) {
    if (excludeId && b.id === excludeId) continue;
    if (b.bayId !== bayId) continue;
    const s = new Date(b.start);
    const e = new Date(b.end);
    // Overlap if s < end AND e > start
    if (s < end && e > start) return b;
  }
  return null;
}

function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative z-10 w-full ${wide ? "max-w-2xl" : "max-w-xl"} rounded-2xl bg-white p-6 shadow-2xl`}>
        {title && <h3 className="mb-4 text-xl font-semibold">{title}</h3>}
        {children}
      </div>
    </div>
  );
}

// 12-hour tick label for gutter
function labelForHour(i: number) {
  const h24 = i % 24;
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:00 ${ampm}`;
}

export default function LocationBookingsPage() {
  const params = useParams() as { slug?: string } | null;
  const slug = (params?.slug ?? "").toString();

  // state
  const [date, setDate] = useState<Date>(startOfDay(new Date()));
  const [data, setData] = useState<DayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // create modal state
  const [creatingDraft, setCreatingDraft] = useState<any>(null);
  const [createConflict, setCreateConflict] = useState<string | null>(null);

  // edit modal state
  const [editing, setEditing] = useState<{
    id: string;
    bayId: string;
    dateOnly: string;
    startHHMM: string;
    duration: number;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  } | null>(null);
  const [editConflict, setEditConflict] = useState<string | null>(null);

  const [page, setPage] = useState(0);

  // layout — taller rows; min 30-min block still compact
  const pxPerMin = 1.2; // 72px per hour, 36px per half-hour
  const totalHeight = Math.round(24 * 60 * pxPerMin);
  const halfHourHeight = Math.round(30 * pxPerMin);
  const maxVisible = 10;

  // refs for DnD
  const bayRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // load
  const load = useCallback(async () => {
    if (!slug) return;
    setError(null);
    try {
      const payload = await fetchJSON<DayPayload>(
        `/api/admin/bookings/day?locationSlug=${encodeURIComponent(slug)}&date=${fmtDate(date)}`
      );
      setData(payload);
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }, [slug, date]);

  useEffect(() => {
    load();
  }, [load]);

  // derived
  const bays = data?.bays || [];
  const totalPages = Math.ceil(bays.length / maxVisible) || 1;
  const safePage = Math.min(page, totalPages - 1);
  const visibleBays = bays.slice(safePage * maxVisible, safePage * maxVisible + maxVisible);

  const timeStep = Math.max(5, data?.minBookingMinutes || 60);
  const timeOptions = useMemo(() => buildTimeOptions(timeStep), [timeStep]);

  // day nav
  const goPrev = () => setDate((d) => new Date(d.getTime() - 86400000));
  const goNext = () => setDate((d) => new Date(d.getTime() + 86400000));
  const goToday = () => setDate(startOfDay(new Date()));

  // ---------- Create booking ----------
  const recalcCreateConflict = (draft: any) => {
    if (!data || !draft) return setCreateConflict(null);
    const startISO = draft.startISO;
    const endISO = draft.endISO;
    const bayId = draft.bayId;
    const conflict = hasOverlap(data.bookings, bayId, startISO, endISO);
    if (conflict) {
      setCreateConflict(
        `Overlaps ${conflict.firstName} ${conflict.lastName} (${new Date(conflict.start).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"})}–${new Date(conflict.end).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"})})`
      );
    } else {
      setCreateConflict(null);
    }
  };

  const handleAddBooking = () => {
    const defaultBay = visibleBays[0]?.id || bays[0]?.id || "";
    const selectedDate = fmtDate(date);
    const nowLocal = new Date();
    const fallbackHHMM = `${String(nowLocal.getHours()).padStart(2, "0")}:${String(
      Math.floor(nowLocal.getMinutes() / timeStep) * timeStep
    ).padStart(2, "0")}`;
    const startISO = mergeDateAndTimeISO(selectedDate, fallbackHHMM);
    const endISO = new Date(new Date(startISO).getTime() + 60 * 60000).toISOString();

    const draft = {
      bayId: defaultBay,
      dateOnly: selectedDate,
      startHHMM: fallbackHHMM,
      startISO,
      endISO,
      duration: 60,
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
    };
    setCreatingDraft(draft);
    // compute initial conflict
    setTimeout(() => recalcCreateConflict(draft), 0);
  };

  const createBooking = async () => {
    if (!data || !creatingDraft) return;
    // final guard
    recalcCreateConflict(creatingDraft);
    if (createConflict) return;

    await fetchJSON(`/api/admin/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId: data.locationId,
        bayId: creatingDraft.bayId,
        firstName: creatingDraft.firstName,
        lastName: creatingDraft.lastName,
        email: creatingDraft.email,
        phone: creatingDraft.phone,
        startISO: creatingDraft.startISO,
        endISO: creatingDraft.endISO,
      }),
    });
    // IMPORTANT: do NOT call /api/notify/confirmation here — server already sends confirmations.
    setCreatingDraft(null);
    await load();
  };

  // ---------- Delete booking ----------
  const deleteBooking = async (id: string) => {
    if (!confirm("Delete this booking?")) return;
    try {
      await fetchJSON(`/api/admin/bookings/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await load();
    } catch (err: any) {
      alert("Error deleting booking: " + err.message);
    }
  };

  // ---------- Edit booking modal ----------
  const openEditModal = (bk: Booking) => {
    const s = new Date(bk.start);
    const dateOnly = fmtDate(s);
    const startHHMM = `${String(s.getHours()).padStart(2, "0")}:${String(s.getMinutes()).padStart(2, "0")}`;
    const duration = Math.max(
      timeStep,
      Math.round((new Date(bk.end).getTime() - s.getTime()) / 60000)
    );
    const next = {
      id: bk.id,
      bayId: bk.bayId,
      dateOnly,
      startHHMM,
      duration,
      firstName: bk.firstName,
      lastName: bk.lastName,
      email: bk.email || "",
      phone: bk.phone || "",
    };
    setEditing(next);
    setEditConflict(null);
  };

  const recalcEditConflict = (state: NonNullable<typeof editing>) => {
    if (!data || !state) return setEditConflict(null);
    const startISO = mergeDateAndTimeISO(state.dateOnly, state.startHHMM);
    const endISO = new Date(new Date(startISO).getTime() + state.duration * 60000).toISOString();
    const conflict = hasOverlap(data.bookings, state.bayId, startISO, endISO, state.id);
    if (conflict) {
      setEditConflict(
        `Overlaps ${conflict.firstName} ${conflict.lastName} (${new Date(conflict.start).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"})}–${new Date(conflict.end).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"})})`
      );
    } else {
      setEditConflict(null);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const startISO = mergeDateAndTimeISO(editing.dateOnly, editing.startHHMM);
    const endISO = new Date(new Date(startISO).getTime() + editing.duration * 60000).toISOString();
    const conflict = data ? hasOverlap(data.bookings, editing.bayId, startISO, endISO, editing.id) : null;
    if (conflict) {
      setEditConflict(
        `Overlaps ${conflict.firstName} ${conflict.lastName} (${new Date(conflict.start).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"})}–${new Date(conflict.end).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"})})`
      );
      return;
    }

    try {
      await fetchJSON(`/api/admin/bookings/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          bayId: editing.bayId,
          startISO,
          endISO,
          firstName: editing.firstName,
          lastName: editing.lastName,
          email: editing.email,
          phone: editing.phone,
        }),
      });
      setEditing(null);
      await load();
    } catch (err: any) {
      alert("Error saving booking: " + err.message);
    }
  };

  // ---------- Drag & Drop (move time/bay) ----------
  const DRAG_KEY = "tee24/booking";

  const onBookingDragStart = (e: React.DragEvent, bk: Booking) => {
    const s = new Date(bk.start);
    const mins = s.getHours() * 60 + s.getMinutes();
    const duration = Math.max(
      timeStep,
      Math.round((new Date(bk.end).getTime() - s.getTime()) / 60000)
    );
    e.dataTransfer.setData(
      DRAG_KEY,
      JSON.stringify({ id: bk.id, startMinutes: mins, durationMinutes: duration })
    );
    const crt = document.createElement("div");
    crt.style.padding = "6px 10px";
    crt.style.background = "#ecfdf5";
    crt.style.border = "1px solid #a7f3d0";
    crt.style.borderRadius = "8px";
    crt.style.fontSize = "12px";
    crt.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
    crt.innerText = `${bk.firstName} ${bk.lastName}`;
    document.body.appendChild(crt);
    e.dataTransfer.setDragImage(crt, 0, 0);
    setTimeout(() => document.body.removeChild(crt), 0);
  };

  const onBayDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_KEY)) e.preventDefault();
  };

  const onBayDrop = async (e: React.DragEvent, bay: Bay) => {
    e.preventDefault();
    const payload = e.dataTransfer.getData(DRAG_KEY);
    if (!payload || !data) return;
    const { id, durationMinutes } = JSON.parse(payload);

    const col = bayRefs.current[bay.id];
    if (!col) return;
    const rect = col.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minutesRaw = Math.max(0, Math.round(y / pxPerMin));
    const snapped = Math.max(0, Math.round(minutesRaw / timeStep) * timeStep);
    const hh = Math.floor(snapped / 60);
    const mm = snapped % 60;

    const dateOnly = fmtDate(date);
    const hhmm = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    const newStartISO = mergeDateAndTimeISO(dateOnly, hhmm);
    const newEndISO = new Date(new Date(newStartISO).getTime() + durationMinutes * 60000).toISOString();

    const conflict = hasOverlap(data.bookings, bay.id, newStartISO, newEndISO, id);
    if (conflict) {
      alert(
        `Cannot move: overlaps ${conflict.firstName} ${conflict.lastName} ` +
        `(${new Date(conflict.start).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"})}–` +
        `${new Date(conflict.end).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"})})`
      );
      return;
    }

    try {
      await fetchJSON(`/api/admin/bookings/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          bayId: bay.id,
          startISO: newStartISO,
          endISO: newEndISO,
        }),
      });
      await load();
    } catch (err: any) {
      alert("Error moving booking: " + err.message);
    }
  };

  // ----- Palette for per-column alternating colors -----
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

  return (
    <div className="p-6 space-y-4">
      {/* Header controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button onClick={goPrev} className="rounded-xl border px-3 py-2 hover:bg-gray-50">
            <ChevronLeft />
          </button>
          <div className="min-w-[220px] rounded-xl border px-4 py-2 text-center text-sm font-medium">
            {date.toLocaleDateString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
          <button onClick={goNext} className="rounded-xl border px-3 py-2 hover:bg-gray-50">
            <ChevronRight />
          </button>
          <button onClick={goToday} className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
            Today
          </button>
        </div>

        <button
          onClick={handleAddBooking}
          className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 text-sm hover:bg-gray-50"
        >
          <Plus /> Add Booking
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Bay header with pagination */}
      <div className="flex items-center justify-between border-b bg-white text-sm font-medium">
        <div
          className="grid flex-1"
          style={{ gridTemplateColumns: `80px repeat(${visibleBays.length}, minmax(120px, 1fr))` }}
        >
          <div className="px-3 py-2 text-right text-gray-500">Time</div>
          {visibleBays.map((bay) => (
            <div key={bay.id} className="px-3 py-2">
              Bay {bay.number}
            </div>
          ))}
        </div>

        {bays.length > maxVisible && (
          <div className="flex items-center gap-2 border-l px-3 py-2 text-xs text-gray-600">
            <span>
              Bays {safePage * maxVisible + 1}–
              {Math.min((safePage + 1) * maxVisible, bays.length)} of {bays.length}
            </span>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="rounded-md border px-2 py-0.5 disabled:opacity-50"
            >
              ←
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="rounded-md border px-2 py-0.5 disabled:opacity-50"
            >
              →
            </button>
          </div>
        )}
      </div>

      {/* Calendar grid */}
      <div className="grid overflow-auto border" style={{ gridTemplateColumns: `80px repeat(${visibleBays.length}, 1fr)` }}>
        {/* Time gutter */}
        <div className="relative" style={{ height: totalHeight }}>
          {Array.from({ length: 25 }).map((_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0 border-t text-right text-[10px] text-gray-500"
              style={{ top: minutesToTop(i * 60, pxPerMin) }}
            >
              <div className="-translate-y-1/2 px-2">{labelForHour(i)}</div>
            </div>
          ))}
        </div>

        {/* Bay columns (drop targets) */}
        {visibleBays.map((bay) => {
          const bookingsForBay = (data?.bookings || [])
            .filter((b) => b.bayId === bay.id)
            .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

          return (
            <div
              key={bay.id}
              ref={(el) => { bayRefs.current[bay.id] = el; }}
              className="relative border-l"
              style={{ height: totalHeight }}
              onDragOver={onBayDragOver}
              onDrop={(e) => onBayDrop(e, bay)}
            >
              {/* grid lines */}
              <div className="absolute inset-0">
                {Array.from({ length: 48 }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t border-gray-100"
                    style={{ top: minutesToTop(i * 30, pxPerMin) }}
                  />
                ))}
                <div className="absolute left-0 right-0 border-t border-gray-100" style={{ top: minutesToTop(24 * 60, pxPerMin) }} />
              </div>

              {/* bookings: full width + single line + tight leading */}
              {bookingsForBay.map((bk, idx) => {
                const s = new Date(bk.start);
                const e = new Date(bk.end);
                const startMins = s.getHours() * 60 + s.getMinutes();
                const endMins = e.getHours() * 60 + e.getMinutes();
                const top = minutesToTop(startMins, pxPerMin);
                const height = Math.max(halfHourHeight / 2, minutesToTop(endMins - startMins, pxPerMin));

                const [bg, br, tx] = palette[idx % palette.length];

                return (
                  <div
                    key={bk.id}
                    className={`absolute left-0 right-0 border-y shadow-sm px-2 py-1 cursor-grab active:cursor-grabbing ${bg} ${br} ${tx}`}
                    style={{ top, height, minHeight: Math.min(height, 28) }}
                    draggable
                    onDragStart={(e) => onBookingDragStart(e, bk)}
                    onClick={() => openEditModal(bk)}
                    title={`${bk.firstName} ${bk.lastName}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[11px] leading-none font-medium truncate">
                        {bk.firstName} {bk.lastName} —{" "}
                        {s.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–{e.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </div>
                      <button
                        className="rounded-md p-1 hover:bg-black/5"
                        title="Delete"
                        onClick={(ev) => { ev.stopPropagation(); deleteBooking(bk.id); }}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Create booking modal */}
      <Modal open={!!creatingDraft} onClose={() => { setCreatingDraft(null); setCreateConflict(null); }} title="Create Booking">
        {creatingDraft && data && (
          <div className="space-y-3 text-sm">
            {createConflict && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {createConflict}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <div className="text-gray-500">First name</div>
                <input
                  className="w-full rounded-lg border p-2"
                  value={creatingDraft.firstName}
                  onChange={(e) =>
                    setCreatingDraft({ ...creatingDraft, firstName: e.target.value })
                  }
                />
              </label>
              <label className="space-y-1">
                <div className="text-gray-500">Last name</div>
                <input
                  className="w-full rounded-lg border p-2"
                  value={creatingDraft.lastName}
                  onChange={(e) =>
                    setCreatingDraft({ ...creatingDraft, lastName: e.target.value })
                  }
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <div className="text-gray-500">Phone</div>
                <input
                  className="w-full rounded-lg border p-2"
                  value={creatingDraft.phone}
                  onChange={(e) =>
                    setCreatingDraft({ ...creatingDraft, phone: e.target.value })
                  }
                />
              </label>
              <label className="space-y-1">
                <div className="text-gray-500">Email</div>
                <input
                  className="w-full rounded-lg border p-2"
                  value={creatingDraft.email}
                  onChange={(e) =>
                    setCreatingDraft({ ...creatingDraft, email: e.target.value })
                  }
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <div className="text-gray-500">Date</div>
                <input
                  type="date"
                  className="w-full rounded-lg border p-2"
                  value={creatingDraft.dateOnly}
                  onChange={(e) => {
                    const dateOnly = e.target.value;
                    const startISO = mergeDateAndTimeISO(dateOnly, creatingDraft.startHHMM);
                    const endISO = new Date(new Date(startISO).getTime() + (creatingDraft.duration || 60) * 60000).toISOString();
                    const draft = { ...creatingDraft, dateOnly, startISO, endISO };
                    setCreatingDraft(draft);
                    recalcCreateConflict(draft);
                  }}
                />
              </label>

              <label className="space-y-1">
                <div className="text-gray-500">Start Time</div>
                <select
                  className={`w-full rounded-lg border p-2 ${createConflict ? "border-red-400" : ""}`}
                  value={creatingDraft.startHHMM}
                  onChange={(e) => {
                    const startHHMM = e.target.value;
                    const startISO = mergeDateAndTimeISO(creatingDraft.dateOnly, startHHMM);
                    const endISO = new Date(new Date(startISO).getTime() + (creatingDraft.duration || 60) * 60000).toISOString();
                    const draft = { ...creatingDraft, startHHMM, startISO, endISO };
                    setCreatingDraft(draft);
                    recalcCreateConflict(draft);
                  }}
                >
                  {timeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <div className="text-gray-500">Duration (minutes)</div>
                <input
                  type="number"
                  min={timeStep}
                  step={timeStep}
                  className={`w-full rounded-lg border p-2 ${createConflict ? "border-red-400" : ""}`}
                  value={creatingDraft.duration || timeStep}
                  onChange={(e) => {
                    const minutes = Math.max(timeStep, Number(e.target.value));
                    const startISO = creatingDraft.startISO;
                    const endISO = new Date(new Date(startISO).getTime() + minutes * 60000).toISOString();
                    const draft = { ...creatingDraft, duration: minutes, endISO };
                    setCreatingDraft(draft);
                    recalcCreateConflict(draft);
                  }}
                />
              </label>

              <label className="space-y-1">
                <div className="text-gray-500">Bay</div>
                <select
                  className={`w-full rounded-lg border p-2 ${createConflict ? "border-red-400" : ""}`}
                  value={creatingDraft.bayId}
                  onChange={(e) => {
                    const draft = { ...creatingDraft, bayId: e.target.value };
                    setCreatingDraft(draft);
                    recalcCreateConflict(draft);
                  }}
                >
                  {data.bays.map((bay) => (
                    <option key={bay.id} value={bay.id}>
                      Bay {bay.number}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button className="rounded-xl border px-3 py-2" onClick={() => { setCreatingDraft(null); setCreateConflict(null); }}>
                Cancel
              </button>
              <button
                className="rounded-xl border bg-white px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
                onClick={createBooking}
                disabled={!!createConflict}
                title={createConflict || undefined}
              >
                Create
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit booking modal */}
      <Modal open={!!editing} onClose={() => { setEditing(null); setEditConflict(null); }} title="Booking Details" wide>
        {editing && data && (
          <div className="space-y-3 text-sm">
            {editConflict && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {editConflict}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <div className="text-gray-500">First name</div>
                <input
                  className="w-full rounded-lg border p-2"
                  value={editing.firstName}
                  onChange={(e) => setEditing((s) => { const n = { ...s!, firstName: e.target.value }; return n; })}
                />
              </label>
              <label className="space-y-1">
                <div className="text-gray-500">Last name</div>
                <input
                  className="w-full rounded-lg border p-2"
                  value={editing.lastName}
                  onChange={(e) => setEditing((s) => { const n = { ...s!, lastName: e.target.value }; return n; })}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <div className="text-gray-500">Phone</div>
                <input
                  className="w-full rounded-lg border p-2"
                  value={editing.phone}
                  onChange={(e) => setEditing((s) => { const n = { ...s!, phone: e.target.value }; return n; })}
                />
              </label>
              <label className="space-y-1">
                <div className="text-gray-500">Email</div>
                <input
                  className="w-full rounded-lg border p-2"
                  value={editing.email}
                  onChange={(e) => setEditing((s) => { const n = { ...s!, email: e.target.value }; return n; })}
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <label className="space-y-1">
                <div className="text-gray-500">Date</div>
                <input
                  type="date"
                  className="w-full rounded-lg border p-2"
                  value={editing.dateOnly}
                  onChange={(e) => {
                    const n = { ...editing, dateOnly: e.target.value };
                    setEditing(n);
                    recalcEditConflict(n);
                  }}
                />
              </label>

              <label className="space-y-1">
                <div className="text-gray-500">Start Time</div>
                <select
                  className={`w-full rounded-lg border p-2 ${editConflict ? "border-red-400" : ""}`}
                  value={editing.startHHMM}
                  onChange={(e) => {
                    const n = { ...editing, startHHMM: e.target.value };
                    setEditing(n);
                    recalcEditConflict(n);
                  }}
                >
                  {timeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <div className="text-gray-500">Duration (minutes)</div>
                <input
                  type="number"
                  min={timeStep}
                  step={timeStep}
                  className={`w-full rounded-lg border p-2 ${editConflict ? "border-red-400" : ""}`}
                  value={editing.duration}
                  onChange={(e) => {
                    const n = { ...editing, duration: Math.max(timeStep, Number(e.target.value)) };
                    setEditing(n);
                    recalcEditConflict(n);
                  }}
                />
              </label>
            </div>

            <label className="space-y-1 block">
              <div className="text-gray-500">Bay</div>
              <select
                className={`w-full rounded-lg border p-2 ${editConflict ? "border-red-400" : ""}`}
                value={editing.bayId}
                onChange={(e) => {
                  const n = { ...editing, bayId: e.target.value };
                  setEditing(n);
                  recalcEditConflict(n);
                }}
              >
                {data.bays.map((bay) => (
                  <option key={bay.id} value={bay.id}>
                    Bay {bay.number}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center justify-between pt-2">
              <button
                className="rounded-xl border px-3 py-2 text-red-600"
                onClick={async () => {
                  if (!confirm("Delete this booking?")) return;
                  await deleteBooking(editing.id);
                  setEditing(null);
                }}
              >
                Delete
              </button>
              <div className="flex items-center gap-2">
                <button className="rounded-xl border px-3 py-2" onClick={() => { setEditing(null); setEditConflict(null); }}>
                  Cancel
                </button>
                <button
                  className="rounded-xl border bg-white px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
                  onClick={saveEdit}
                  disabled={!!editConflict}
                  title={editConflict || undefined}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}



