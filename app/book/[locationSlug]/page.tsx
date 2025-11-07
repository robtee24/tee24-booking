// src/app/book/[locationSlug]/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

type Slot = {
  start: string;           // ISO
  end: string;             // ISO
  availableBays: number[]; // e.g., [1,2,3]
};

const STEP_MINUTES = 30;
const DURATIONS = [30, 60, 90, 120];

// ---------- helpers ----------
function pad(n: number) { return String(n).padStart(2, "0"); }
function addMinutes(d: Date, mins: number) { return new Date(d.getTime() + mins * 60000); }
function ymd(d: Date) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function hhmm(d: Date) { return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }
function toDisplayTime(d: Date) { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "UTC", }); }
function sameYMD(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function ceilToStep(date: Date, stepMin = STEP_MINUTES) {
  const aligned = new Date(date);
  const minutes = aligned.getUTCMinutes();
  const ceiled = Math.ceil(minutes / stepMin) * stepMin;
  aligned.setUTCMinutes(ceiled, 0, 0);
  return aligned;
}

// phone formatting: (###) ###-#### as user types
function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  const len = digits.length;
  if (len < 4) return digits;
  if (len < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// Generate start times that fit entirely inside a slot (respecting duration & bay)
function generateTimesForSlot(
  slot: Slot,
  durationMin: number,
  dateStr: string,
  bay: "any" | number
) {
  if (bay !== "any" && !slot.availableBays.includes(bay)) return [];
  if (bay === "any" && slot.availableBays.length === 0) return [];

  const startISO = new Date(slot.start);
  const endISO = new Date(slot.end);
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const windowStart = new Date(Math.max(dayStart.getTime(), startISO.getTime()));
  const firstStart = ceilToStep(windowStart, STEP_MINUTES);

  const out: string[] = [];
  for (
    let t = firstStart;
    t.getTime() <= endISO.getTime() - durationMin * 60000;
    t = addMinutes(t, STEP_MINUTES)
  ) {
    if (t >= windowStart) {
      out.push(hhmm(t));
    }
  }
  return out;
}

function uniqSortedTimes(times: string[]) { return Array.from(new Set(times)).sort(); }

// Validators
function isValidEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()); }
function isValidPhone(phone: string) { return phone.replace(/\D/g, "").length === 10; }

// ---------- API helpers ----------
async function fetchAvailability(
  locationSlug: string,
  date: string,
  partyKind: "SINGLE" | "GROUP",
  handedness: "RH" | "LH" | ""
): Promise<Slot[]> {
  const params = new URLSearchParams({
    locationSlug,
    date,
    kind: partyKind,
  });
  if (partyKind === "SINGLE" && handedness) params.set("hand", handedness);

  const res = await fetch(`/api/availability?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    let message = `Availability request failed (${res.status})`;
    try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
    throw new Error(message);
  }
  const data = await res.json();
  return (data?.slots ?? []) as Slot[];
}

async function fetchLocationInfo(locationSlug: string): Promise<{
  id: string; name: string; slug: string; bookingNote: string;
  minBookingMinutes?: number; maxBookingMinutes?: number; bayNumbers?: number[];
  passAccessUrl?: string | null;
}> {
  const res = await fetch(`/api/location-info?locationSlug=${encodeURIComponent(locationSlug)}`, { cache: "no-store" });
  if (!res.ok) {
    let message = `Location info request failed (${res.status})`;
    try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
    throw new Error(message);
  }
  return res.json();
}

async function createBooking({
  locationSlug,
  startISO,
  endISO,
  bayValue,
  firstName,
  lastName,
  phone,
  email,
  partyKind,
  handedness,
}: {
  locationSlug: string;
  startISO: string;
  endISO: string;
  bayValue: "any" | number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  partyKind: "SINGLE" | "GROUP";
  handedness?: "RH" | "LH";
}) {
  const res = await fetch(`/api/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locationSlug,
      start: startISO,
      end: endISO,
      bay: bayValue,
      firstName,
      lastName,
      phone,
      email,
      partyKind,
      handedness,
    }),
  });
  if (!res.ok) {
    let message = `Booking failed (${res.status})`;
    try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
    throw new Error(message);
  }
  return res.json();
}

// ---------- component ----------
export default function BookPage() {
  const params = useParams<{ locationSlug: string }>();
  const locationSlug = String(params?.locationSlug ?? "");

  const today = useMemo(() => new Date(), []);
  const [locationName, setLocationName] = useState<string>("");
  const [adminNote, setAdminNote] = useState<string>("");
  const [passUrl, setPassUrl] = useState<string | null>(null);

  const [date, setDate] = useState<string>(ymd(today));
  const [partyKind, setPartyKind] = useState<"SINGLE" | "GROUP">("GROUP");
  const [handedness, setHandedness] = useState<"RH" | "LH">("RH");

  const [bay, setBay] = useState<"any" | number>("any");
  const [duration, setDuration] = useState<number>(60);
  const [startTime, setStartTime] = useState<string>("");

  const [availability, setAvailability] = useState<Slot[]>([]);
  const [loadingAvail, setLoadingAvail] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // step control (1 = time selection, 2 = contact)
  const [step, setStep] = useState<1 | 2>(1);

  // contact info
  const [firstName, setFirstName] = useState<string>("");
  const [lastName, setLastName] = useState<string>("");
  const [phone, setPhone] = useState<string>(""); // formatted
  const [email, setEmail] = useState<string>("");

  // errors for inputs
  const [emailErr, setEmailErr] = useState<string>("");
  const [phoneErr, setPhoneErr] = useState<string>("");

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [confirmed, setConfirmed] = useState<null | {
    id: string;
    locationName: string;
    bayNumber: number;
    start: string;
    end: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  }>(null);

  const dateInputRef = useRef<HTMLInputElement>(null);

  // Load location name + note + pass URL
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!locationSlug) return;
      try {
        const info = await fetchLocationInfo(locationSlug);
        if (!cancelled) {
          setLocationName(info.name || locationSlug);
          setAdminNote(info.bookingNote || "");
          setPassUrl(info.passAccessUrl ?? null);
        }
      } catch {
        if (!cancelled) {
          setLocationName(locationSlug);
          setPassUrl(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [locationSlug]);

  // Load availability for selected date/location with filters
  async function reloadAvailability() {
    if (!locationSlug) return;
    try {
      setLoadingAvail(true);
      setError("");
      const slots = await fetchAvailability(
        locationSlug,
        date,
        partyKind,
        partyKind === "SINGLE" ? handedness : ""
      );
      setAvailability(slots);
    } catch (e: any) {
      setError(e?.message || "Failed to load availability.");
      setAvailability([]);
    } finally {
      setLoadingAvail(false);
    }
  }

  useEffect(() => {
    reloadAvailability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationSlug, date, partyKind, handedness]);

  // Compute bay options from availability (numbers found across all slots)
  const bayOptions = useMemo(() => {
    const s = new Set<number>();
    for (const slot of availability) slot.availableBays.forEach((b) => s.add(b));
    return Array.from(s).sort((a, b) => a - b);
  }, [availability]);

  // Compute start time options that fit the chosen duration
  const startOptions = useMemo(() => {
    if (!availability.length) return [];
    let times: string[] = [];
    for (const slot of availability) {
        const slotTimes = generateTimesForSlot(slot, duration, date, bay);
        times = times.concat(slotTimes);
    }
    let arr = uniqSortedTimes(times);

    // Hide past times...
    const selectedDate = new Date(`${date}T00:00:00`);
    if (sameYMD(selectedDate, today)) {
        const now = new Date();
        const cutoff = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        arr = arr.filter((t) => t >= cutoff);
    }
    return arr;
  }, [availability, duration, bay, date, today]);

  // Display "3:00 PM"
  const startOptionsDisplay = useMemo(() => {
    return startOptions.map((t) => {
        const d = new Date(`${date}T${t}:00.000Z`);
        return { value: t, label: toDisplayTime(d) };
    });
  }, [startOptions, date]);

  // Handlers: basic format validation on blur/change
  function handleEmailBlur() {
    setEmailErr(isValidEmail(email) ? "" : "Enter a valid email (e.g., name@example.com).");
  }
  function handlePhoneBlur() {
    setPhoneErr(isValidPhone(phone) ? "" : "Enter a valid 10-digit phone (e.g., (555) 123-4567).");
  }

  // Submit booking
  async function onSubmit() {
    try {
      setSubmitting(true);
      setError("");

      if (!date || !startTime) throw new Error("Please select date and start time.");
      if (!firstName || !lastName || !phone || !email) throw new Error("Please enter your contact information.");
      if (!isValidEmail(email)) {
        setEmailErr("Enter a valid email (e.g., name@example.com).");
        throw new Error("Invalid email.");
      }
      if (!isValidPhone(phone)) {
        setPhoneErr("Enter a valid 10-digit phone (e.g., (555) 123-4567).");
        throw new Error("Invalid phone.");
      }

      const start = new Date(`${date}T${startTime}:00`);
      const end = addMinutes(start, duration);
      const bayValue = bay === "any" ? "any" : Number(bay);

      const { booking } = await createBooking({
        locationSlug,
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        bayValue,
        firstName,
        lastName,
        phone,
        email,
        partyKind,
        handedness: partyKind === "SINGLE" ? handedness : undefined,
      });

      // Refresh availability behind the scenes
      void reloadAvailability();

      // Show confirmation
      setConfirmed({
        id: booking.id,
        locationName: booking.locationName,
        bayNumber: booking.bayNumber,
        start: booking.start,
        end: booking.end,
        firstName,
        lastName,
        email,
        phone,
      });

      setStartTime("");
    } catch (e: any) {
      if (!/Invalid (email|phone)/.test(e?.message)) {
        setError(e?.message || "Booking failed.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ---------- UI ----------
  return (
    <div className="mx-auto max-w-3xl p-6 text-black">
      {/* Admin note (dynamic per location) */}
      {adminNote ? (
        <div className="mb-4 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-yellow-900 text-sm">
          {adminNote}
        </div>
      ) : null}

      {confirmed ? (
        // ===== Confirmation view =====
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold">Booking Confirmed</h1>
          <p className="text-sm text-gray-700">
            We’ve sent a confirmation to <span className="font-medium">{confirmed.email}</span>.
          </p>

          <div className="rounded-xl border border-gray-300 p-4 text-sm">
            <div className="flex justify-between py-1"><span>Location</span><span className="font-medium">{confirmed.locationName}</span></div>
            <div className="flex justify-between py-1"><span>Bay</span><span className="font-medium">Bay {confirmed.bayNumber}</span></div>
            <div className="flex justify-between py-1"><span>Start</span><span className="font-medium">{new Date(confirmed.start).toLocaleString()}</span></div>
            <div className="flex justify-between py-1"><span>End</span><span className="font-medium">{new Date(confirmed.end).toLocaleString()}</span></div>
            <div className="flex justify-between py-1"><span>Name</span><span className="font-medium">{confirmed.firstName} {confirmed.lastName}</span></div>
            <div className="flex justify-between py-1"><span>Email</span><span className="font-medium">{confirmed.email}</span></div>
            <div className="flex justify-between py-1"><span>Phone</span><span className="font-medium">{confirmed.phone}</span></div>
            <div className="mt-3 text-xs text-gray-500">Booking ID: {confirmed.id}</div>
          </div>

          <div className="mt-6 flex gap-2">
            <button
              className="rounded-lg border border-black px-5 py-3 text-black"
              onClick={() => { setConfirmed(null); setStep(1); }}
            >
              Make another booking
            </button>
            <a
              className="ml-auto rounded-lg border border-black px-5 py-3 text-black"
              href={passUrl ?? "/passes"}
              target="_blank"
              rel="noreferrer"
            >
              Buy Access (For Non-Members)
            </a>
          </div>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-semibold mb-1">
            Book a Bay <span className="text-gray-700">({locationName || locationSlug})</span>
          </h1>

          {error && <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-700 text-sm">{error}</div>}

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6 text-sm">
            {[1, 2].map((i) => (<div key={i} className={`flex-1 h-2 rounded-full ${i <= step ? "bg-black" : "bg-gray-200"}`} />))}
          </div>

          {step === 1 && (
            <div className="space-y-4">
              {/* Date */}
              <div>
                <label className="block text-sm font-medium mb-1">Date</label>
                <div
                  className="relative inline-flex w-full items-center rounded-xl border border-gray-300 px-4 py-3 cursor-pointer hover:bg-gray-50"
                  onClick={() => (document.getElementById("dateInput") as HTMLInputElement)?.showPicker?.()}
                >
                  <input
                    id="dateInput"
                    type="date"
                    className="outline-none bg-transparent cursor-pointer w-full"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    min={ymd(today)}
                  />
                </div>
              </div>

              {/* Party type & (conditional) handedness */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Playing as</label>
                  <select
                    className="w-full rounded-xl border border-gray-300 px-3 py-3"
                    value={partyKind}
                    onChange={(e) => {
                      const v = e.target.value as "SINGLE" | "GROUP";
                      setPartyKind(v);
                      setStartTime("");
                      setBay("any");
                    }}
                  >
                    <option value="GROUP">Group</option>
                    <option value="SINGLE">Single</option>
                  </select>
                </div>

                {partyKind === "SINGLE" && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Handedness</label>
                    <select
                      className="w-full rounded-xl border border-gray-300 px-3 py-3"
                      value={handedness}
                      onChange={(e) => {
                        setHandedness(e.target.value as "RH" | "LH");
                        setStartTime("");
                        setBay("any");
                      }}
                    >
                      <option value="RH">Right-handed</option>
                      <option value="LH">Left-handed</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Duration */}
              <div>
                <label className="block text-sm font-medium mb-2">Duration</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {DURATIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => { setDuration(d); setStartTime(""); }}
                      className={`rounded-lg border px-3 py-2 text-sm ${
                        duration === d ? "border-black bg-black text-white" : "border-gray-300 text-black"
                      }`}
                    >
                      {d} min
                    </button>
                  ))}
                </div>
              </div>

              {/* Bay (optional) */}
              <div>
                <label className="block text-sm font-medium mb-1">Bay (optional)</label>
                <select
                  className="w-full rounded-xl border border-gray-300 px-3 py-3"
                  value={bay === "any" ? "any" : String(bay)}
                  onChange={(e) => {
                    const v = e.target.value === "any" ? "any" : Number(e.target.value);
                    setBay(v as any);
                    setStartTime(""); // reset when bay changes
                  }}
                  disabled={!bayOptions.length}
                >
                  <option value="any">Any Available Bay</option>
                  {bayOptions.map((n) => (<option key={n} value={n}>Bay {n}</option>))}
                </select>
                <div className="mt-2 text-xs text-gray-600">
                  {loadingAvail ? "Loading availability…" : `Found ${bayOptions.length || 0} bays with availability.`}
                </div>
              </div>

              {/* Start time */}
              <div>
                <label className="block text-sm font-medium mb-1">Start Time</label>
                <select
                  className="w-full rounded-xl border border-gray-300 px-3 py-3"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  disabled={loadingAvail}
                >
                  <option value="" disabled>
                    {loadingAvail ? "Loading…" : startOptionsDisplay.length ? "Select a time" : "No times available"}
                  </option>
                  {startOptionsDisplay.map(({ value, label }) => (<option key={value} value={value}>{label}</option>))}
                </select>
              </div>

              <div className="flex gap-2 mt-2">
                <button
                  className="rounded-lg bg-black px-5 py-3 text-white disabled:opacity-40"
                  onClick={() => setStep(2)}
                  disabled={!date || !startTime}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {/* First Name */}
              <div>
                <label className="block text-sm font-medium mb-1">First Name</label>
                <input
                  className="w-full rounded-xl border border-gray-300 px-3 py-3"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Jane"
                />
              </div>

              {/* Last Name */}
              <div>
                <label className="block text-sm font-medium mb-1">Last Name</label>
                <input
                  className="w-full rounded-xl border border-gray-300 px-3 py-3"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="block text-sm font-medium mb-1">Phone</label>
                <input
                  className={`w-full rounded-xl border px-3 py-3 ${phoneErr ? "border-red-400" : "border-gray-300"}`}
                  value={phone}
                  onChange={(e) => {
                    const formatted = formatPhone(e.target.value);
                    setPhone(formatted);
                    if (phoneErr) setPhoneErr("");
                  }}
                  onBlur={handlePhoneBlur}
                  placeholder="(555) 123-4567"
                />
                {phoneErr && <p className="text-xs text-red-600 mt-1">{phoneErr}</p>}
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  className={`w-full rounded-xl border px-3 py-3 ${emailErr ? "border-red-400" : "border-gray-300"}`}
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (emailErr) setEmailErr(""); }}
                  onBlur={handleEmailBlur}
                  placeholder="name@example.com"
                />
                {emailErr && <p className="text-xs text-red-600 mt-1">{emailErr}</p>}
              </div>

              <div className="flex gap-2">
                <button className="rounded-lg border border-black px-5 py-3 text-black" onClick={() => setStep(1)}>Back</button>
                <button
                  className="rounded-lg bg-black px-5 py-3 text-white disabled:opacity-40"
                  onClick={onSubmit}
                  disabled={submitting || !firstName || !lastName || !phone || !email || !!emailErr || !!phoneErr}
                >
                  {submitting ? "Booking…" : "Confirm Booking"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}








