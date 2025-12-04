// app/admin/locations/[slug]/bookings/page.tsx
"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

// Shared types
import type { AdminDayView, Bay, AdminBooking } from "@/types/admin-booking";

// Icons (stubs)
const Trash2 = (props: any) => <span {...props}>Trash</span>;
const ChevronLeft = (props: any) => <span {...props}>Previous</span>;
const ChevronRight = (props: any) => <span {...props}>Next</span>;
const Plus = (props: any) => <span {...props}>Plus</span>;

// Helpers
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const minutesToTop = (m: number, px: number) => Math.round(m * px);

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

function buildLocalISO(dateOnly: string, hhmm: string): string {
  return `${dateOnly}T${hhmm}:00`;
}

function addMinutesToLocalISO(localISO: string, minutes: number): string {
  const [datePart, timePart] = localISO.split("T");
  const [h, m] = timePart.split(":").map(Number);
  const base = new Date(`${datePart}T${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:00`);
  const result = new Date(base.getTime() + minutes * 60 * 1000);
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, "0")}-${String(result.getDate()).padStart(2, "0")}T${String(result.getHours()).padStart(2, "0")}:${String(result.getMinutes()).padStart(2, "0")}:00`;
}

function Modal({ open, onClose, title, children, wide = false }: any) {
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

const DRAG_KEY = "admin-booking-drag";

export default function LocationBookingsPage() {
  const params = useParams() as { slug?: string };
  const slug = params?.slug?.toString() ?? "";

  const [date, setDate] = useState<Date>(startOfDay(new Date()));
  const [data, setData] = useState<AdminDayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [page, setPage] = useState(0);

  const pxPerMin = 1.2;
  const totalHeight = Math.round(24 * 60 * pxPerMin);
  const maxVisible = 10;
  const bayRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const load = useCallback(async () => {
    if (!slug) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/bookings/day?locationSlug=${slug}&date=${fmtDate(date)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e: any) {
      setError(e.message || "Failed to load bookings");
    }
  }, [slug, date]);

  useEffect(() => { load(); }, [load]);

  const bays = useMemo(() => (data?.bays || []).sort((a, b) => a.number - b.number), [data?.bays]);
  const totalPages = Math.ceil(bays.length / maxVisible) || 1;
  const safePage = Math.min(page, totalPages - 1);
  const visibleBays = useMemo(() => bays.slice(safePage * maxVisible, (safePage + 1) * maxVisible), [bays, safePage]);

  // This is the actual step used for snapping (e.g. 15, 30)
  const timeStep = Math.max(5, data?.minBookingMinutes || 60);
  const timeOptions = useMemo(() => buildTimeOptions(timeStep), [timeStep]);

  const goPrev = () => setDate(d => new Date(d.getTime() - 86400000));
  const goNext = () => setDate(d => new Date(d.getTime() + 86400000));
  const goToday = () => setDate(startOfDay(new Date()));

  // Secure admin API
  const adminApi = async (method: "POST" | "PATCH", payload: any) => {
    const res = await fetch("/api/admin/bookings", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Request failed");
    }
    return res.json();
  };

  // Add Booking
  const handleAddBooking = () => {
    const defaultBay = visibleBays[0]?.id || bays[0]?.id || "";
    const selectedDate = fmtDate(date);
    const now = new Date();
    const roundedMinutes = Math.floor(now.getMinutes() / timeStep) * timeStep;
    const fallbackHHMM = `${String(now.getHours()).padStart(2, "0")}:${String(roundedMinutes).padStart(2, "0")}`;
    const startLocal = buildLocalISO(selectedDate, fallbackHHMM);
    const endLocal = addMinutesToLocalISO(startLocal, timeStep);

    setCreatingDraft({
      bayId: defaultBay,
      dateOnly: selectedDate,
      startHHMM: fallbackHHMM,
      startLocal,
      endLocal,
      duration: timeStep,
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
    });
  };

  // Create booking
  const createBooking = async () => {
    if (!data || !creatingDraft || !creatingDraft.firstName.trim()) return;

    const bayNumber = bays.find(b => b.id === creatingDraft.bayId)?.number;
    if (!bayNumber) return alert("Invalid bay");

    try {
      await adminApi("POST", {
        locationSlug: slug,
        startLocal: creatingDraft.startLocal,
        endLocal: creatingDraft.endLocal,
        bayNumber,
        firstName: creatingDraft.firstName.trim(),
        lastName: creatingDraft.lastName?.trim() || undefined,
        email: creatingDraft.email?.trim() || null,
        phone: creatingDraft.phone?.trim() || null,
      });

      setCreatingDraft(null);
      await load();
    } catch (err: any) {
      alert("Create failed: " + err.message);
    }
  };

  // Update booking
  const updateBooking = async (id: string, updates: { bayId: string; startLocal: string; endLocal: string }) => {
    const bayNumber = bays.find(b => b.id === updates.bayId)?.number;
    if (!bayNumber) throw new Error("Invalid bay");

    try {
      await adminApi("POST", {
        locationSlug: slug,
        startLocal: updates.startLocal,
        endLocal: updates.endLocal,
        bayNumber,
      });

      await adminApi("PATCH", { id, bayId: updates.bayId });
      await load();
    } catch (err: any) {
      alert("Cannot move booking: " + err.message);
      throw err;
    }
  };

  // Save edit
  const saveEdit = async () => {
    if (!editing) return;

    const bayNumber = bays.find(b => b.id === editing.bayId)?.number;
    if (!bayNumber) return alert("Invalid bay");

    const startLocal = buildLocalISO(editing.dateOnly, editing.startHHMM);
    const endLocal = addMinutesToLocalISO(startLocal, editing.duration);

    try {
      await updateBooking(editing.id, { bayId: editing.bayId, startLocal, endLocal });

      await adminApi("PATCH", {
        id: editing.id,
        firstName: editing.firstName.trim(),
        lastName: editing.lastName?.trim() || undefined,
        email: editing.email?.trim() || null,
        phone: editing.phone?.trim() || null,
      });

      setEditing(null);
    } catch (err: any) {
      alert("Save failed: " + err.message);
    }
  };

  // Drag handlers
  const onBookingDragStart = (e: React.DragEvent, bk: AdminBooking) => {
    const duration = Math.round((new Date(bk.end).getTime() - new Date(bk.start).getTime()) / 60000);
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
    if (!payload) return;

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
    const newStartLocal = buildLocalISO(dateOnly, hhmm);
    const newEndLocal = addMinutesToLocalISO(newStartLocal, durationMinutes);

    try {
      await updateBooking(id, { bayId: bay.id, startLocal: newStartLocal, endLocal: newEndLocal });
    } catch {}
  };

  // Delete
  const deleteBooking = async (id: string) => {
    if (!confirm("Delete this booking?")) return;
    try {
      await fetch("/api/admin/bookings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await load();
    } catch (err: any) {
      alert("Delete failed: " + err.message);
    }
  };

  // Palette
  const palette = [
    ["bg-blue-50", "border-blue-200", "text-blue-900"],
    ["bg-emerald-50", "border-emerald-200", "text-emerald-900"],
    ["bg-amber-50", "border-amber-200", "text-amber-900"],
    ["bg-violet-50", "border-violet-200", "text-violet-900"],
    ["bg-rose-50", "border-rose-200", "text-rose-900"],
  ];

const getBlockedSlots = (bayId: string) => {
  const bayNumber = bays.find(b => b.id === bayId)?.number;
  if (!bayNumber || !data) return [];

  const tz = data.timezone;
  console.log("Timezone:", tz);

  const slots = data.bookings
    .filter(b => b.bayNumber === bayNumber)
    .map(b => {
      const startUTC = new Date(b.start);
      const endUTC = new Date(b.end);

      // Convert to local time using location's timezone
      const startLocal = new Date(startUTC.toLocaleString("en-US", { timeZone: tz }));
      const endLocal = new Date(endUTC.toLocaleString("en-US", { timeZone: tz }));

      const startMins = startLocal.getHours() * 60 + startLocal.getMinutes();
      const endMins = endLocal.getHours() * 60 + endLocal.getMinutes();

      console.log(`Booking ID: ${b.id} | Bay ${bayNumber} | Local: ${startLocal.toLocaleTimeString()} → ${endLocal.toLocaleTimeString()} | Mins: ${startMins} → ${endMins}`);

      return { startMins, endMins };
    });

  console.log("Blocked slots for bay", bayNumber, ":", slots);
  return slots;
};

const isSlotBlocked = (startMins: number, durationMins: number, blockedSlots: any[]) => {
  const proposedEnd = startMins + durationMins;

  console.log(`Checking slot: ${minsToTime(startMins)} → ${minsToTime(proposedEnd)} (${durationMins} mins)`);

  const blocked = blockedSlots.some(slot => {
    const overlaps = startMins < slot.endMins && proposedEnd > slot.startMins;
    if (overlaps) {
      console.log(`BLOCKED by: ${minsToTime(slot.startMins)} → ${minsToTime(slot.endMins)} | Condition: ${startMins} < ${slot.endMins} && ${proposedEnd} > ${slot.startMins} → ${overlaps}`);
    }
    return overlaps;
  });

  if (!blocked) {
    console.log("ALLOWED (no overlap)");
  }

  return blocked;
};

// Helper for readable time
const minsToTime = (mins: number) => {
  const h = Math.floor(mins / 60).toString().padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
};

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
            .filter(b => b.bayNumber === bay.number)
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
              {/* Dynamic grid lines */}
              <div className="absolute inset-0">
                {Array.from({ length: Math.ceil(1440 / timeStep) }).map((_, i) => {
                  const mins = i * timeStep;
                  const isHour = mins % 60 === 0;
                  return (
                    <div
                      key={i}
                      className={`absolute left-0 right-0 border-t ${isHour ? "border-gray-300" : "border-gray-100"}`}
                      style={{ top: minutesToTop(mins, pxPerMin) }}
                    />
                  );
                })}
              </div>

              {/* Bookings */}
              {bookingsForBay.map((bk, idx) => {
                const startUTC = new Date(bk.start);
                const endUTC = new Date(bk.end);
                const tz = data!.timezone;
                const startLocal = new Date(startUTC.toLocaleString("en-US", { timeZone: tz }));
                const endLocal = new Date(endUTC.toLocaleString("en-US", { timeZone: tz }));

                let displayStartMins = startLocal.getHours() * 60 + startLocal.getMinutes();
                let displayEndMins = endLocal.getHours() * 60 + endLocal.getMinutes();
                if (startLocal < startOfDay(date)) displayStartMins = 0;
                if (endLocal > new Date(date.getTime() + 24 * 60 * 60 * 1000)) displayEndMins = 24 * 60;

                const top = minutesToTop(displayStartMins, pxPerMin);
                const height = minutesToTop(displayEndMins - displayStartMins, pxPerMin);
                const timeLabel = `${startLocal.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${endLocal.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
                const [bg, br, tx] = palette[idx % palette.length];

                return (
                  <div
                    key={bk.id}
                    className={`absolute left-0 right-0 border-y shadow-sm px-2 py-1 cursor-grab active:cursor-grabbing ${bg} ${br} ${tx}`}
                    style={{ top, height, minHeight: Math.min(height, 28) }}
                    draggable
                    onDragStart={e => onBookingDragStart(e, bk)}
                    onClick={() => {
                      const duration = Math.max(timeStep, Math.round((endUTC.getTime() - startUTC.getTime()) / 60000));
                      setEditing({
                        id: bk.id,
                        bayId: bay.id,
                        dateOnly: fmtDate(startLocal),
                        startHHMM: `${String(startLocal.getHours()).padStart(2, "0")}:${String(startLocal.getMinutes()).padStart(2, "0")}`,
                        duration,
                        firstName: bk.firstName,
                        lastName: bk.lastName || "",
                        email: bk.email || "",
                        phone: bk.phone || "",
                      });
                    }}
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
      <Modal open={!!creatingDraft} onClose={() => setCreatingDraft(null)} title="Create Booking">
        {creatingDraft && data && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bay</label>
                <select
                  value={creatingDraft.bayId}
                  onChange={e => setCreatingDraft({ ...creatingDraft, bayId: e.target.value })}
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
                    const startLocal = buildLocalISO(creatingDraft.dateOnly, e.target.value);
                    const endLocal = addMinutesToLocalISO(startLocal, creatingDraft.duration);
                    setCreatingDraft({ ...creatingDraft, startHHMM: e.target.value, startLocal, endLocal });
                  }}
                  className="w-full rounded-lg border px-3 py-2"
                >
                  {(() => {
                    const blockedSlots = getBlockedSlots(creatingDraft.bayId);
                    const durationMins = creatingDraft.duration;

                    console.log("Creating draft for bay:", creatingDraft.bayId, "Duration:", durationMins, "minutes");

                    return timeOptions
                      .filter(option => {
                        const [h, m] = option.value.split(":").map(Number);
                        const startMins = h * 60 + m;
const allowed = !isSlotBlocked(startMins, durationMins, blockedSlots);
      if (!allowed) {
        console.log(`Option ${option.label} (${option.value}) BLOCKED`);
      }
      return allowed;                      })
                      .map(o => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ));
                  })()}
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
                  const endLocal = addMinutesToLocalISO(creatingDraft.startLocal, minutes);
                  setCreatingDraft({ ...creatingDraft, duration: minutes, endLocal });
                }}
                className="w-full rounded-lg border px-3 py-2"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <input placeholder="First Name *" value={creatingDraft.firstName} onChange={e => setCreatingDraft({ ...creatingDraft, firstName: e.target.value })} className="rounded-lg border px-3 py-2" />
              <input placeholder="Last Name" value={creatingDraft.lastName} onChange={e => setCreatingDraft({ ...creatingDraft, lastName: e.target.value })} className="rounded-lg border px-3 py-2" />
              <input placeholder="Email (optional)" value={creatingDraft.email} onChange={e => setCreatingDraft({ ...creatingDraft, email: e.target.value })} className="rounded-lg border px-3 py-2" />
              <input placeholder="Phone (optional)" value={creatingDraft.phone} onChange={e => setCreatingDraft({ ...creatingDraft, phone: e.target.value })} className="rounded-lg border px-3 py-2" />
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button onClick={() => setCreatingDraft(null)} className="rounded-xl border px-4 py-2">Cancel</button>
              <button
                onClick={createBooking}
                disabled={!creatingDraft.firstName.trim()}
                className="rounded-xl bg-black text-white px-4 py-2 disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Modal - You can add smart dropdown later */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit Booking" wide>
        {editing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bay</label>
                <select value={editing.bayId} onChange={e => setEditing({ ...editing, bayId: e.target.value })} className="w-full rounded-lg border px-3 py-2">
                  {bays.map(b => <option key={b.id} value={b.id}>Bay {b.number}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                <select value={editing.startHHMM} onChange={e => setEditing({ ...editing, startHHMM: e.target.value })} className="w-full rounded-lg border px-3 py-2">
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
                onChange={e => setEditing({ ...editing, duration: Math.max(timeStep, Number(e.target.value) || timeStep) })}
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
                <button onClick={() => setEditing(null)} className="rounded-xl border px-4 py-2">Cancel</button>
                <button onClick={saveEdit} className="rounded-xl bg-black text-white px-4 py-2">Save Changes</button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}