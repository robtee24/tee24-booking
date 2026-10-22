// app/admin/locations/[slug]/bookings/page.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "next/navigation";
import type { AdminDayView, AdminBooking } from "@/types/admin-booking";
import type { Bay } from "@/types/bay";
import { EditBookingModal } from "./components/EditBookingModal";
import { CreateBookingModal } from "./components/CreateBookingModal";
import { BookingHeader } from "./components/BookingHeader";
import { BookingGrid } from "./components/BookingGrid";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

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

const DRAG_KEY = "admin-booking-drag";

// ──────────────────────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────────────────────
export default function LocationBookingsPage() {
  const params = useParams() as { slug?: string };
  const slug = params?.slug?.toString() ?? "";

  const [date, setDate] = useState<Date>(() => startOfDay(new Date()));
  const [data, setData] = useState<AdminDayView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creatingDraft, setCreatingDraft] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);

  type MemberLookup = {
    byEmail: Record<string, { status: string; membershipType: string | null }>;
    byPhone: Record<string, { status: string; membershipType: string | null }>;
  };
  const [memberLookup, setMemberLookup] = useState<MemberLookup>({ byEmail: {}, byPhone: {} });

  const pxPerMin = 1.2;
  const totalHeight = Math.round(24 * 60 * pxPerMin);
  const bayRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ───── Load Data ─────
  const load = useCallback(async () => {
    if (!slug) {
      setError("Invalid location");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/bookings/day?locationSlug=${slug}&date=${fmtDate(date)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to load bookings");
      }
      const json: AdminDayView = await res.json();
      setData(json);

      try {
        const mRes = await fetch(`/api/admin/members/lookup?locationSlug=${slug}`, { cache: 'no-store' });
        if (mRes.ok) setMemberLookup(await mRes.json());
      } catch {}
    } catch (e: any) {
      setError(e.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [slug, date]);

  useEffect(() => {
    load();
  }, [load]);

  // ───── Derived Data ─────
  const bays = useMemo(
    () => (data?.bays || []).sort((a, b) => a.number - b.number),
    [data?.bays]
  );

  const bookings = data?.bookings;
  const locationTimezone = data?.timezone ?? "UTC";
  const timeStep = Math.max(5, data?.minBookingMinutes || 60);
  const timeOptions = useMemo(() => buildTimeOptions(timeStep), [timeStep]);

  // ───── Navigation ─────
  const goPrev = () => setDate((d) => new Date(d.getTime() - 86400000));
  const goNext = () => setDate((d) => new Date(d.getTime() + 86400000));
  const goToday = () => setDate(startOfDay(new Date()));

  // ───── API Helpers ─────
  const apiFetch = async (url: string, options: RequestInit) => {
    const res = await fetch(url, options);
    if (!res.ok) {
      const text = await res.text();
      const message = text || res.statusText || "Request failed";
      const err = new Error(message);
      (err as any).status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  };

  // ───── Blocked Slots Helper ─────
  const getBlockedSlots = useCallback(
    (bayId: string, dateOnly: string) => {
      if (!bookings) return [];
      return bookings
        .filter((b) => {
          const bookingDate = fmtDate(new Date(b.start));
          return b.bayId === bayId && bookingDate === dateOnly;
        })
        .map((b) => {
          const start = new Date(b.start);
          const end = new Date(b.end);
          const startMins = start.getHours() * 60 + start.getMinutes();
          const endMins = end.getHours() * 60 + end.getMinutes();
          return { startMins, endMins };
        });
    },
    [bookings]
  );

  const isSlotBlocked = (
    startMins: number,
    durationMins: number,
    blockedSlots: { startMins: number; endMins: number }[]
  ) => {
    const endMins = startMins + durationMins;
    return blockedSlots.some(
      (slot) => startMins < slot.endMins && endMins > slot.startMins
    );
  };

  // ───── CRUD Handlers ─────
  const createBooking = async () => {
    if (!creatingDraft || !creatingDraft.firstName.trim()) return;

    const bayNumber = bays.find((b) => b.id === creatingDraft.bayId)?.number;
    if (!bayNumber) return alert("Invalid bay");

    try {
      await apiFetch("/api/admin/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationSlug: slug,
          startLocal: creatingDraft.startLocal,
          endLocal: creatingDraft.endLocal,
          bayNumber,
          firstName: creatingDraft.firstName.trim(),
          lastName: creatingDraft.lastName?.trim() || undefined,
          email: creatingDraft.email?.trim() || null,
          phone: creatingDraft.phone?.trim() || null,
        }),
      });
      setCreatingDraft(null);
      await load();
    } catch (err: any) {
      alert("Create failed: " + err.message);
    }
  };

  const updateBooking = async (
    id: string,
    updates: {
      bayId?: string;
      startLocal?: string;
      endLocal?: string;
      firstName?: string;
      lastName?: string;
      email?: string | null;
      phone?: string | null;
    }
  ) => {
    try {
      await apiFetch(`/api/admin/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      await load();
    } catch (err: any) {
      if ((err as any).status === 409) {
        alert("Cannot move booking: Time slot is already taken.");
      } else {
        alert("Update failed: " + err.message);
      }
      throw err;
    }
  };

  const deleteBooking = async (id: string) => {
    if (!confirm("Delete this booking?")) return;
    try {
      await apiFetch(`/api/admin/bookings/${id}`, { method: "DELETE" });
      await load();
    } catch (err: any) {
      alert("Delete failed: " + err.message);
    }
  };

  const handleAddBooking = () => {
    const defaultBay = bays[0]?.id || "";
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

  const saveEdit = async () => {
    if (!editing) return;

    // Use the updated dateOnly from editing state (can be different from current view!)
    const startLocal = buildLocalISO(editing.dateOnly, editing.startHHMM);
    const endLocal = addMinutesToLocalISO(startLocal, editing.duration);

    try {
      await updateBooking(editing.id, {
        bayId: editing.bayId,
        startLocal,
        endLocal,
        firstName: editing.firstName.trim(),
        lastName: editing.lastName?.trim() || undefined,
        email: editing.email?.trim() || null,
        phone: editing.phone?.trim() || null,
      });
      setEditing(null);
    } catch {
      // error already shown
    }
  };

  // ───── Drag & Drop ─────
  const onBookingDragStart = (e: React.DragEvent, bk: AdminBooking) => {
    const duration = Math.round(
      (new Date(bk.end).getTime() - new Date(bk.start).getTime()) / 60000
    );
    e.dataTransfer.setData(
      DRAG_KEY,
      JSON.stringify({ id: bk.id, durationMinutes: duration })
    );
    const crt = document.createElement("div");
    crt.style.cssText =
      "padding:6px 10px; background:#ecfdf5; border:1px solid #a7f3d0; border-radius:8px; font-size:12px; box-shadow:0 4px 12px rgba(0,0,0,0.15);";
    crt.innerText = `${bk.firstName} ${bk.lastName || ""}`.trim();
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
      await updateBooking(id, {
        bayId: bay.id,
        startLocal: newStartLocal,
        endLocal: newEndLocal,
      });
    } catch {}
  };

  const onBookingClick = (bk: AdminBooking, bay: Bay) => {
    const startDateUTC = new Date(bk.start);
    const dateFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: locationTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const dateParts = dateFormatter.formatToParts(startDateUTC);
    const year = dateParts.find((p) => p.type === "year")?.value || "";
    const month = dateParts.find((p) => p.type === "month")?.value || "";
    const day = dateParts.find((p) => p.type === "day")?.value || "";
    const dateOnly = `${year}-${month}-${day}`;

    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: locationTimezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const timeParts = timeFormatter.formatToParts(startDateUTC);
    const hour = timeParts.find((p) => p.type === "hour")?.value.padStart(2, "0") || "00";
    const minute = timeParts.find((p) => p.type === "minute")?.value.padStart(2, "0") || "00";
    const startHHMM = `${hour}:${minute}`;

    const duration = Math.max(
      timeStep,
      Math.round((new Date(bk.end).getTime() - startDateUTC.getTime()) / 60000)
    );

    setEditing({
      id: bk.id,
      bayId: bay.id,
      dateOnly,
      startHHMM,
      duration,
      firstName: bk.firstName,
      lastName: bk.lastName || "",
      email: bk.email || "",
      phone: bk.phone || "",
    });
  };

  // ───── Member Status Lookup ─────
  const getMemberStatus = useCallback(
    (email?: string, phone?: string): string | null => {
      if (email) {
        const m = memberLookup.byEmail[email.toLowerCase()];
        if (m) return m.status;
      }
      if (phone) {
        const m = memberLookup.byPhone[phone];
        if (m) return m.status;
      }
      return null;
    },
    [memberLookup]
  );

  // ───── Palette ─────
  const palette = [
    ["bg-blue-100", "border-blue-300", "text-blue-900"],
    ["bg-emerald-100", "border-emerald-300", "text-emerald-900"],
    ["bg-amber-100", "border-amber-300", "text-amber-900"],
    ["bg-violet-100", "border-violet-300", "text-violet-900"],
    ["bg-rose-100", "border-rose-300", "text-rose-900"],
    ["bg-indigo-100", "border-indigo-300", "text-indigo-900"],
    ["bg-teal-100", "border-teal-300", "text-teal-900"],
  ];

  // ───── Render ─────
  return (
    <div className="p-6 space-y-6 min-h-screen bg-gray-50">
      <BookingHeader
        date={date}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        onAddBooking={handleAddBooking}
        disabled={loading}
      />

      {error && (
        <div className="max-w-2xl mx-auto rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-800 font-medium">{error}</p>
          <button
            onClick={load}
            className="mt-3 text-sm underline text-red-700 hover:text-red-900"
          >
            Try again
          </button>
        </div>
      )}

      {loading && (
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse">
            <div className="h-10 bg-gray-200 rounded w-64 mb-4"></div>
            <div className="grid grid-cols-11 gap-0">
              <div className="h-96 bg-gray-200 border-r"></div>
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-96 bg-gray-100 border-r"></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loading && !error && data && bays.length > 0 && (
        <>
          <div className="overflow-x-auto" style={{ minWidth: 0 }}>
            <div style={{ minWidth: `${80 + bays.length * 140}px` }}>
              <BookingGrid
                visibleBays={bays}
                bookings={bookings}
                locationTimezone={locationTimezone}
                date={date}
                timeStep={timeStep}
                pxPerMin={pxPerMin}
                totalHeight={totalHeight}
                palette={palette}
                bayRefs={bayRefs}
                onBookingDragStart={onBookingDragStart}
                onBayDragOver={onBayDragOver}
                onBayDrop={onBayDrop}
                onBookingClick={onBookingClick}
                onDeleteBooking={deleteBooking}
                getMemberStatus={getMemberStatus}
              />
            </div>
          </div>

          <CreateBookingModal
            open={!!creatingDraft}
            onClose={() => setCreatingDraft(null)}
            draft={creatingDraft}
            bays={bays}
            timeStep={timeStep}
            timeOptions={timeOptions}
            getBlockedSlots={getBlockedSlots}
            isSlotBlocked={isSlotBlocked}
            onUpdateDraft={(updates) =>
              setCreatingDraft((prev: any) => (prev ? { ...prev, ...updates } : null))
            }
            onCreate={createBooking}
          />

          <EditBookingModal
            open={!!editing}
            onClose={() => setEditing(null)}
            editing={editing}
            bays={bays}
            timeStep={timeStep}
            timeOptions={timeOptions}
            onSave={saveEdit}
            onDelete={deleteBooking}
            onUpdateField={(updates) =>
              setEditing((prev: any) => (prev ? { ...prev, ...updates } : null))
            }
            memberStatus={editing ? getMemberStatus(editing.email, editing.phone) : null}
          />
        </>
      )}

      {!loading && !error && data && bays.length === 0 && (
        <div className="text-center py-20 text-gray-500">
          <p className="text-xl font-medium">
            No bays configured for this location
          </p>
          <p className="mt-2">
            Add bays in location settings to start accepting bookings.
          </p>
        </div>
      )}
    </div>
  );
}