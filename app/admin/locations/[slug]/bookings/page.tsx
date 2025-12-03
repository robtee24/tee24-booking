// app/admin/locations/[slug]/bookings/page.tsx
"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { useParams } from "next/navigation";

// --- tiny icon stubs ---
const Trash2 = (props: any) => <span {...props}>Trash</span>;
const ChevronLeft = (props: any) => <span {...props}>Previous</span>;
const ChevronRight = (props: any) => <span {...props}>Next</span>;
const Plus = (props: any) => <span {...props}>Plus</span>;

type Bay = { id: string; number: number };
type Booking = {
  id: string;
  bayId: string;
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

// Build "HH:MM" options across 24h
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

// SAFE: Build local time string (YYYY-MM-DDTHH:MM:00) — no Z, no UTC shift
function buildLocalISO(dateOnly: string, hhmm: string): string {
  return `${dateOnly}T${hhmm}:00`;
}

// SAFE: Add minutes and return correct local ISO (handles midnight rollover)
function addMinutesToLocalISO(localISO: string, minutes: number): string {
  const [datePart, timePart] = localISO.split("T");
  const [h, m] = timePart.split(":").map(Number);
  const base = new Date(`${datePart}T${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:00`);
  const result = new Date(base.getTime() + minutes * 60 * 1000);

  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, "0")}-${String(result.getDate()).padStart(2, "0")}T${String(result.getHours()).padStart(2, "0")}:${String(result.getMinutes()).padStart(2, "0")}:00`;
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

// Client-side overlap check
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

function labelForHour(i: number) {
  const h24 = i % 24;
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:00 ${ampm}`;
}

export default function LocationBookingsPage() {
  const params = useParams() as { slug?: string } | null;
  const slug = (params?.slug ?? "").toString();

  const [date, setDate] = useState<Date>(startOfDay(new Date()));
  const [data, setData] = useState<DayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [creatingDraft, setCreatingDraft] = useState<any>(null);
  const [createConflict, setCreateConflict] = useState<string | null>(null);

  const [editing, setEditing] = useState<any>(null);
  const [editConflict, setEditConflict] = useState<string | null>(null);

  const [page, setPage] = useState(0);

  const pxPerMin = 1.2;
  const totalHeight = Math.round(24 * 60 * pxPerMin);
  const halfHourHeight = Math.round(30 * pxPerMin);
  const maxVisible = 10;

  const bayRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

  const bays = useMemo(() => {
    return (data?.bays || []).sort((a, b) => a.number - b.number);
  }, [data?.bays]);

  const totalPages = Math.ceil(bays.length / maxVisible) || 1;
  const safePage = Math.min(page, totalPages - 1);
  const visibleBays = useMemo(() => {
    return bays.slice(safePage * maxVisible, (safePage + 1) * maxVisible);
  }, [bays, safePage, maxVisible]);

  const timeStep = Math.max(5, data?.minBookingMinutes || 60);
  const timeOptions = useMemo(() => buildTimeOptions(timeStep), [timeStep]);

  const goPrev = () => setDate(d => new Date(d.getTime() - 86400000));
  const goNext = () => setDate(d => new Date(d.getTime() + 86400000));
  const goToday = () => setDate(startOfDay(new Date()));

  // ========== CREATE BOOKING ==========
  const recalcCreateConflict = (draft: any) => {
    if (!data || !draft) return setCreateConflict(null);
    const conflict = hasOverlap(data.bookings, draft.bayId, draft.startISO, draft.endISO);
    setCreateConflict(conflict ? `Overlaps ${conflict.firstName} ${conflict.lastName}` : null);
  };

  const handleAddBooking = () => {
    const defaultBay = visibleBays[0]?.id || bays[0]?.id || "";
    const selectedDate = fmtDate(date);
    const nowLocal = new Date();
    const roundedMinutes = Math.floor(nowLocal.getMinutes() / timeStep) * timeStep;
    const fallbackHHMM = `${String(nowLocal.getHours()).padStart(2, "0")}:${String(roundedMinutes).padStart(2, "0")}`;

    const startISO = buildLocalISO(selectedDate, fallbackHHMM);
    const endISO = addMinutesToLocalISO(startISO, 60);

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
    setTimeout(() => recalcCreateConflict(draft), 0);
  };

  const createBooking = async () => {
    if (!data || !creatingDraft || createConflict) return;
    await fetchJSON(`/api/admin/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId: data.locationId,
        bayId: creatingDraft.bayId,
        firstName: creatingDraft.firstName,
        lastName: creatingDraft.lastName,
        email: creatingDraft.email || null,
        phone: creatingDraft.phone || null,
        startISO: creatingDraft.startISO,
        endISO: creatingDraft.endISO,
      }),
    });
    setCreatingDraft(null);
    await load();
  };

  // ========== DELETE ==========
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
      alert("Error deleting: " + err.message);
    }
  };

  // ========== EDIT MODAL ==========
  const openEditModal = (bk: Booking) => {
    const s = new Date(bk.start);
    const dateOnly = fmtDate(s);
    const startHHMM = `${String(s.getHours()).padStart(2, "0")}:${String(s.getMinutes()).padStart(2, "0")}`;
    const duration = Math.max(timeStep, Math.round((new Date(bk.end).getTime() - s.getTime()) / 60000));

    setEditing({
      id: bk.id,
      bayId: bk.bayId,
      dateOnly,
      startHHMM,
      duration,
      firstName: bk.firstName,
      lastName: bk.lastName,
      email: bk.email || "",
      phone: bk.phone || "",
    });
    setEditConflict(null);
  };

  const recalcEditConflict = (state: any) => {
    if (!data) return;
    const startISO = buildLocalISO(state.dateOnly, state.startHHMM);
    const endISO = addMinutesToLocalISO(startISO, state.duration);
    const conflict = hasOverlap(data.bookings, state.bayId, startISO, endISO, state.id);
    setEditConflict(conflict ? `Overlaps ${conflict.firstName} ${conflict.lastName}` : null);
  };

  const saveEdit = async () => {
    if (!editing || editConflict) return;
    const startISO = buildLocalISO(editing.dateOnly, editing.startHHMM);
    const endISO = addMinutesToLocalISO(startISO, editing.duration);

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
        email: editing.email || null,
        phone: editing.phone || null,
      }),
    });
    setEditing(null);
    await load();
  };

  // ========== DRAG & DROP ==========
  const DRAG_KEY = "tee24/booking";

  const onBookingDragStart = (e: React.DragEvent, bk: Booking) => {
    const s = new Date(bk.start);
    const mins = s.getHours() * 60 + s.getMinutes();
    const duration = Math.round((new Date(bk.end).getTime() - s.getTime()) / 60000);
    e.dataTransfer.setData(DRAG_KEY, JSON.stringify({ id: bk.id, durationMinutes: duration }));

    const crt = document.createElement("div");
    crt.style.cssText = "padding:6px 10px; background:#ecfdf5; border:1px solid #a7f3d0; border-radius:8px; font-size:12px; box-shadow:0 4px 12px rgba(0,0,0,0.15);";
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
    const minutesRaw = Math.round(y / pxPerMin);
    const snapped = Math.round(minutesRaw / timeStep) * timeStep;
    const hh = Math.floor(snapped / 60);
    const mm = snapped % 60;
    const hhmm = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    const dateOnly = fmtDate(date);

    const newStartISO = buildLocalISO(dateOnly, hhmm);
    const newEndISO = addMinutesToLocalISO(newStartISO, durationMinutes);

    const conflict = hasOverlap(data.bookings, bay.id, newStartISO, newEndISO, id);
    if (conflict) {
      alert(`Cannot move: overlaps ${conflict.firstName} ${conflict.lastName}`);
      return;
    }

    await fetchJSON(`/api/admin/bookings/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, bayId: bay.id, startISO: newStartISO, endISO: newEndISO }),
    });
    await load();
  };

  // Palette
  const palette = [
    ["bg-blue-50", "border-blue-200", "text-blue-900"],
    ["bg-emerald-50", "border-emerald-200", "text-emerald-900"],
    ["bg-amber-50", "border-amber-200", "text-amber-900"],
    ["bg-violet-50", "border-violet-200", "text-violet-900"],
    ["bg-rose-50", "border-rose-200", "text-rose-900"],
  ];

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button onClick={goPrev} className="rounded-xl border px-3 py-2 hover:bg-gray-50"><ChevronLeft /></button>
          <div className="min-w-[220px] rounded-xl border px-4 py-2 text-center text-sm font-medium">
            {date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </div>
          <button onClick={goNext} className="rounded-xl border px-3 py-2 hover:bg-gray-50"><ChevronRight /></button>
          <button onClick={goToday} className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">Today</button>
        </div>
        <button onClick={handleAddBooking} className="inline-flex items-center gap-1 rounded-xl border bg-white px-3 py-2 text-sm hover:bg-gray-50">
          <Plus /> Add Booking
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Grid Header */}
      <div className="flex items-center justify-between border-b bg-white text-sm font-medium">
        <div className="grid flex-1" style={{ gridTemplateColumns: `80px repeat(${visibleBays.length}, minmax(120px, 1fr))` }}>
          <div className="px-3 py-2 text-right text-gray-500">Time</div>
          {visibleBays.map(bay => <div key={bay.id} className="px-3 py-2">Bay {bay.number}</div>)}
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="grid overflow-auto border" style={{ gridTemplateColumns: `80px repeat(${visibleBays.length}, 1fr)` }}>
        {/* Time gutter */}
        <div className="relative" style={{ height: totalHeight }}>
          {Array.from({ length: 25 }).map((_, i) => (
            <div key={i} className="absolute left-0 right-0 border-t text-right text-[10px] text-gray-500" style={{ top: minutesToTop(i * 60, pxPerMin) }}>
              <div className="-translate-y-1/2 px-2">{labelForHour(i)}</div>
            </div>
          ))}
        </div>

        {/* Bay columns */}
        {visibleBays.map(bay => {
          const bookingsForBay = (data?.bookings || [])
            .filter(b => b.bayId === bay.id)
            .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

          return (
            <div
              key={bay.id}
              ref={el => { bayRefs.current[bay.id] = el; }}
              className="relative border-l"
              style={{ height: totalHeight }}
              onDragOver={onBayDragOver}
              onDrop={e => onBayDrop(e, bay)}
            >
              <div className="absolute inset-0">
                {Array.from({ length: 48 }).map((_, i) => (
                  <div key={i} className="absolute left-0 right-0 border-t border-gray-100" style={{ top: minutesToTop(i * 30, pxPerMin) }} />
                ))}
              </div>

              {bookingsForBay.map((bk, idx) => {
                const startUTC = new Date(bk.start);
                const endUTC = new Date(bk.end);
                const tz = data!.timezone; // e.g. "America/New_York"

                const startLocal = toZonedTime(startUTC, tz);
                const endLocal = toZonedTime(endUTC, tz);

                // Midnight of the currently viewed day (in local time)
                const viewedDayMidnight = new Date(date);
                viewedDayMidnight.setHours(0, 0, 0, 0);

                // Clamp booking to visible day
                let displayStartMins = startLocal.getHours() * 60 + startLocal.getMinutes();
                let displayEndMins = endLocal.getHours() * 60 + endLocal.getMinutes();

                if (startLocal < viewedDayMidnight) {
                    displayStartMins = 0; // started yesterday → show from midnight
                }
                if (endLocal > new Date(viewedDayMidnight.getTime() + 24 * 60 * 60 * 1000)) {
                    displayEndMins = 24 * 60; // ends tomorrow → cap at end of day
                }

                const top = minutesToTop(displayStartMins, pxPerMin);
                const height = minutesToTop(displayEndMins - displayStartMins, pxPerMin);

                // Use local time for label
                const timeLabel = `${startLocal.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${endLocal.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

                const [bg, br, tx] = palette[idx % palette.length];

                return (
                  <div
                    key={bk.id}
                    className={`absolute left-0 right-0 border-y shadow-sm px-2 py-1 cursor-grab active:cursor-grabbing ${bg} ${br} ${tx}`}
                    style={{ top, height, minHeight: Math.min(height, 28) }}
                    draggable
                    onDragStart={e => onBookingDragStart(e, bk)}
                    onClick={() => openEditModal(bk)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[11px] leading-none font-medium truncate">
                        {bk.firstName} {bk.lastName} — {timeLabel}
                      </div>
                      <button className="rounded-md p-1 hover:bg-black/5" onClick={ev => { ev.stopPropagation(); deleteBooking(bk.id); }}>
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

      {/* Create Modal */}
      <Modal open={!!creatingDraft} onClose={() => { setCreatingDraft(null); setCreateConflict(null); }} title="Create Booking">
        {creatingDraft && data && (
          <div className="space-y-4">
            {createConflict && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{createConflict}</div>}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bay</label>
                <select
                  value={creatingDraft.bayId}
                  onChange={e => {
                    const draft = { ...creatingDraft, bayId: e.target.value };
                    setCreatingDraft(draft);
                    recalcCreateConflict(draft);
                  }}
                  className="w-full rounded-lg border px-3 py-2"
                >
                  {bays.map(b => <option key={b.id} value={b.id}>Bay {b.number}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                <select
                  value={creatingDraft.startHHMM}
                  onChange={e => {
                    const startISO = buildLocalISO(creatingDraft.dateOnly, e.target.value);
                    const endISO = addMinutesToLocalISO(startISO, creatingDraft.duration);
                    const draft = { ...creatingDraft, startHHMM: e.target.value, startISO, endISO };
                    setCreatingDraft(draft);
                    recalcCreateConflict(draft);
                  }}
                  className="w-full rounded-lg border px-3 py-2"
                >
                  {timeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duration (minutes)</label>
              <input
                type="number"
                min={timeStep}
                step={timeStep}
                value={creatingDraft.duration}
                onChange={e => {
                  const minutes = Math.max(timeStep, Number(e.target.value) || timeStep);
                  const endISO = addMinutesToLocalISO(creatingDraft.startISO, minutes);
                  const draft = { ...creatingDraft, duration: minutes, endISO };
                  setCreatingDraft(draft);
                  recalcCreateConflict(draft);
                }}
                className="w-full rounded-lg border px-3 py-2"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <input placeholder="First Name" value={creatingDraft.firstName} onChange={e => setCreatingDraft({ ...creatingDraft, firstName: e.target.value })} className="rounded-lg border px-3 py-2" />
              <input placeholder="Last Name" value={creatingDraft.lastName} onChange={e => setCreatingDraft({ ...creatingDraft, lastName: e.target.value })} className="rounded-lg border px-3 py-2" />
              <input placeholder="Email (optional)" value={creatingDraft.email} onChange={e => setCreatingDraft({ ...creatingDraft, email: e.target.value })} className="rounded-lg border px-3 py-2" />
              <input placeholder="Phone (optional)" value={creatingDraft.phone} onChange={e => setCreatingDraft({ ...creatingDraft, phone: e.target.value })} className="rounded-lg border px-3 py-2" />
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button onClick={() => { setCreatingDraft(null); setCreateConflict(null); }} className="rounded-xl border px-4 py-2">Cancel</button>
              <button onClick={createBooking} disabled={!!createConflict || !creatingDraft.firstName} className="rounded-xl bg-black text-white px-4 py-2 disabled:opacity-50">Create</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editing} onClose={() => { setEditing(null); setEditConflict(null); }} title="Edit Booking" wide>
        {editing && (
          <div className="space-y-4">
            {editConflict && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{editConflict}</div>}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bay</label>
                <select
                  value={editing.bayId}
                  onChange={e => { const n = { ...editing, bayId: e.target.value }; setEditing(n); recalcEditConflict(n); }}
                  className="w-full rounded-lg border px-3 py-2"
                >
                  {bays.map(b => <option key={b.id} value={b.id}>Bay {b.number}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                <select
                  value={editing.startHHMM}
                  onChange={e => {
                    const n = { ...editing, startHHMM: e.target.value };
                    setEditing(n);
                    recalcEditConflict(n);
                  }}
                  className="w-full rounded-lg border px-3 py-2"
                >
                  {timeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duration (minutes)</label>
              <input
                type="number"
                min={timeStep}
                step={timeStep}
                value={editing.duration}
                onChange={e => {
                  const n = { ...editing, duration: Math.max(timeStep, Number(e.target.value) || timeStep) };
                  setEditing(n);
                  recalcEditConflict(n);
                }}
                className="w-full rounded-lg border px-3 py-2"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <input placeholder="First Name" value={editing.firstName} onChange={e => setEditing({ ...editing, firstName: e.target.value })} className="rounded-lg border px-3 py-2" />
              <input placeholder="Last Name" value={editing.lastName} onChange={e => setEditing({ ...editing, lastName: e.target.value })} className="rounded-lg border px-3 py-2" />
              <input placeholder="Email" value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} className="rounded-lg border px-3 py-2" />
              <input placeholder="Phone" value={editing.phone} onChange={e => setEditing({ ...editing, phone: e.target.value })} className="rounded-lg border px-3 py-2" />
            </div>

            <div className="flex justify-between pt-4">
              <button onClick={() => deleteBooking(editing.id)} className="text-red-600 font-medium">Delete Booking</button>
              <div className="flex gap-3">
                <button onClick={() => { setEditing(null); setEditConflict(null); }} className="rounded-xl border px-4 py-2">Cancel</button>
                <button onClick={saveEdit} disabled={!!editConflict} className="rounded-xl bg-black text-white px-4 py-2 disabled:opacity-50">Save Changes</button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}