// app/book/[locationSlug]/page.tsx
"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

const DURATIONS = [30, 60, 90, 120] as const;

type AvailabilityResponse = {
  slots: { start: string; end: string; availableCount: number }[];
  startTimes: Record<number, string[]>; // e.g. { 60: ["09:00", "14:30"] }
};

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidPhone(phone: string): boolean {
  return phone.replace(/\D/g, "").length === 10;
}

async function fetchAvailability(
  locationSlug: string,
  date: string,
  partyKind: "SINGLE" | "GROUP",
  handedness: "RH" | "LH" | ""
): Promise<AvailabilityResponse> {
  const params = new URLSearchParams({ locationSlug, date, kind: partyKind });
  if (partyKind === "SINGLE" && handedness) params.set("hand", handedness);
  const res = await fetch(`/api/availability?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to load availability (${res.status})`);
  }
  return res.json();
}

async function fetchLocationInfo(locationSlug: string) {
  const res = await fetch(`/api/location-info?locationSlug=${encodeURIComponent(locationSlug)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to load location");
  return res.json();
}

async function createBooking(data: any) {
  const res = await fetch("/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Booking failed");
  }
  return res.json();
}

export default function BookPage() {
  const params = useParams<{ locationSlug: string }>();
  const locationSlug = String(params?.locationSlug ?? "");

  const today = useMemo(() => new Date(), []);
  const todayYMD = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const [date, setDate] = useState(todayYMD);
  const [partyKind, setPartyKind] = useState<"SINGLE" | "GROUP">("GROUP");
  const [handedness, setHandedness] = useState<"RH" | "LH">("RH");
  const [duration, setDuration] = useState<number>(60);
  const [startTime, setStartTime] = useState<string>("");
  const [locationName, setLocationName] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [passUrl, setPassUrl] = useState<string | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [phoneErr, setPhoneErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<any>(null);

  // Load location info
  useEffect(() => {
    if (!locationSlug) return;
    let cancelled = false;
    (async () => {
      try {
        const info = await fetchLocationInfo(locationSlug);
        if (!cancelled) {
          setLocationName(info.name || locationSlug);
          setAdminNote(info.bookingNote || "");
          setPassUrl(info.passAccessUrl ?? null);
        }
      } catch {
        if (!cancelled) setLocationName(locationSlug);
      }
    })();
    return () => { cancelled = true; };
  }, [locationSlug]);

  // Load availability
  const loadAvailability = async () => {
    if (!locationSlug || !date) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchAvailability(locationSlug, date, partyKind, partyKind === "SINGLE" ? handedness : "");
      setAvailability(data);
      setStartTime(""); // reset selection
    } catch (e: any) {
      setError(e.message || "Failed to load times");
      setAvailability(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAvailability();
  }, [locationSlug, date, partyKind, handedness]);

  // Available start times for current duration
  const availableStartTimes = useMemo(() => {
    if (!availability?.startTimes[duration]) return [];
    let times = availability.startTimes[duration];
    // Hide past times today
    if (date === todayYMD) {
      const now = new Date();
      const cutoff = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      times = times.filter(t => t >= cutoff);
    }
    return times;
  }, [availability, duration, date, todayYMD]);

  // Optional: show how many bays are free at selected time
  const baysAvailableAtTime = useMemo(() => {
    if (!startTime || !availability) return 0;
    const selectedISO = `${date}T${startTime}:00.000`;
    const slot = availability.slots.find(s => s.start <= selectedISO && s.end > selectedISO);
    return slot?.availableCount || 0;
  }, [startTime, availability, date]);

  // FIXED: Correctly build local time strings (no Z, no timezone confusion)
  const onSubmit = async () => {
    setSubmitting(true);
    setError("");
    if (!isValidEmail(email)) return setEmailErr("Valid email required");
    if (!isValidPhone(phone)) return setPhoneErr("10-digit phone required");

    try {
      const [year, month, day] = date.split("-");
      const [hour, minute] = startTime.split(":");

      // Start time in local format (e.g. 2025-11-25T23:30:00)
      const startISO = `${year}-${month}-${day}T${hour}:${minute}:00`;

      // End time: add duration and format correctly (handles date rollover)
      const startDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
      const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

      const endISO = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}T${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}:00`;

      const { booking } = await createBooking({
        locationSlug,
        startISO,
        endISO,
        bay: "any",
        firstName,
        lastName,
        phone,
        email,
        partyKind,
        handedness: partyKind === "SINGLE" ? handedness : undefined,
      });

      setConfirmed(booking);
      void loadAvailability();
    } catch (e: any) {
      setError(e.message || "Booking failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6 text-black">
      {adminNote && (
        <div className="mb-6 rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
          {adminNote}
        </div>
      )}

      {confirmed ? (
        <div className="space-y-6">
          <h1 className="text-3xl font-bold">Booking Confirmed!</h1>
          <p className="text-gray-600">Confirmation sent to {confirmed.email}</p>
          <div className="rounded-xl border border-gray-300 p-6 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div><strong>Location</strong></div><div>{confirmed.locationName}</div>
              <div><strong>Bay</strong></div><div>Bay {confirmed.bayNumber}</div>
              <div><strong>Date & Time</strong></div>
              <div>
                {new Date(confirmed.start).toLocaleDateString()} •{" "}
                {new Date(confirmed.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} –{" "}
                {new Date(confirmed.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </div>
              <div><strong>Name</strong></div><div>{confirmed.firstName} {confirmed.lastName}</div>
            </div>
            <div className="mt-4 text-xs text-gray-500">ID: {confirmed.id}</div>
          </div>
          <div className="flex gap-4">
            <button onClick={() => { setConfirmed(null); setStep(1); }} className="rounded-lg border border-black px-6 py-3">
              Book Another
            </button>
            <a href={passUrl ?? "/passes"} target="_blank" rel="noreferrer" className="ml-auto rounded-lg bg-black px-6 py-3 text-white">
              Buy Access Pass
            </a>
          </div>
        </div>
      ) : (
        <>
          <h1 className="text-3xl font-bold mb-2">
            Book a Bay <span className="text-gray-600 font-normal">({locationName || locationSlug})</span>
          </h1>
          {error && <div className="mb-4 p-4 bg-red-50 border border-red-300 rounded-lg text-red-700">{error}</div>}
          <div className="flex gap-2 mb-8">
            <div className={`h-2 flex-1 rounded-full ${step >= 1 ? "bg-black" : "bg-gray-300"}`} />
            <div className={`h-2 flex-1 rounded-full ${step >= 2 ? "bg-black" : "bg-gray-300"}`} />
          </div>

          {step === 1 ? (
            <div className="space-y-6">
              {/* Date */}
              <div>
                <label className="block text-sm font-medium mb-2">Date</label>
                <input
                  type="date"
                  min={todayYMD}
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3"
                />
              </div>

              {/* Party Type + Handedness */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Playing As</label>
                  <select
                    value={partyKind}
                    onChange={e => { setPartyKind(e.target.value as any); setStartTime(""); }}
                    className="w-full rounded-xl border border-gray-300 px-4 py-3"
                  >
                    <option value="GROUP">Group</option>
                    <option value="SINGLE">Single</option>
                  </select>
                </div>
                {partyKind === "SINGLE" && (
                  <div>
                    <label className="block text-sm font-medium mb-2">Handedness</label>
                    <select
                      value={handedness}
                      onChange={e => { setHandedness(e.target.value as any); setStartTime(""); }}
                      className="w-full rounded-xl border border-gray-300 px-4 py-3"
                    >
                      <option value="RH">Right-handed</option>
                      <option value="LH">Left-handed</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Duration */}
              <div>
                <label className="block text-sm font-medium mb-3">Duration</label>
                <div className="grid grid-cols-4 gap-3">
                  {DURATIONS.map(d => (
                    <button
                      key={d}
                      onClick={() => { setDuration(d); setStartTime(""); }}
                      className={`rounded-lg border py-3 text-sm font-medium transition ${
                        duration === d
                          ? "bg-black text-white border-black"
                          : "border-gray-300 hover:border-gray-500"
                      }`}
                    >
                      {d} min
                    </button>
                  ))}
                </div>
              </div>

              {/* Start Time */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Start Time {baysAvailableAtTime > 0 && `(${baysAvailableAtTime} bay${baysAvailableAtTime > 1 ? "s" : ""} free)`}
                </label>
                <select
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  disabled={loading || availableStartTimes.length === 0}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 disabled:opacity-50"
                >
                  <option value="">
                    {loading ? "Loading…" : availableStartTimes.length ? "Select a time" : "No times available"}
                  </option>
                  {availableStartTimes.map(time => {
                    const dateObj = new Date(`${date}T${time}:00`);
                    const label = dateObj.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                    return <option key={time} value={time}>{label}</option>;
                  })}
                </select>
              </div>

              <button
                onClick={() => setStep(2)}
                disabled={!startTime}
                className="w-full bg-black text-white py-4 rounded-xl font-medium disabled:opacity-40"
              >
                Continue to Contact
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="text-lg font-medium mb-4">
                {date} • {new Date(`${date}T${startTime}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} –{" "}
                {new Date(new Date(`${date}T${startTime}`).getTime() + duration * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                {" "}({duration} min)
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">First Name</label>
                  <input value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full rounded-xl border border-gray-300 px-4 py-3" placeholder="Jane" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Last Name</label>
                  <input value={lastName} onChange={e => setLastName(e.target.value)} className="w-full rounded-xl border border-gray-300 px-4 py-3" placeholder="Doe" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Phone</label>
                <input
                  value={phone}
                  onChange={e => { setPhone(formatPhone(e.target.value)); phoneErr && setPhoneErr(""); }}
                  onBlur={() => !isValidPhone(phone) && setPhoneErr("10 digits required")}
                  className={`w-full rounded-xl border px-4 py-3 ${phoneErr ? "border-red-500" : "border-gray-300"}`}
                  placeholder="(555) 123-4567"
                />
                {phoneErr && <p className="text-red-600 text-sm mt-1">{phoneErr}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); emailErr && setEmailErr(""); }}
                  onBlur={() => !isValidEmail(email) && setEmailErr("Valid email required")}
                  className={`w-full rounded-xl border px-4 py-3 ${emailErr ? "border-red-500" : "border-gray-300"}`}
                  placeholder="jane@example.com"
                />
                {emailErr && <p className="text-red-600 text-sm mt-1">{emailErr}</p>}
              </div>

              <div className="flex gap-4">
                <button onClick={() => setStep(1)} className="flex-1 border border-black py-4 rounded-xl">
                  Back
                </button>
                <button
                  onClick={onSubmit}
                  disabled={submitting || !firstName || !lastName || !phone || !email || !!emailErr || !!phoneErr}
                  className="flex-1 bg-black text-white py-4 rounded-xl disabled:opacity-40 font-medium"
                >
                  {submitting ? "Booking…" : "Confirm & Book"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}