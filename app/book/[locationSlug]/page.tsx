// app/book/[locationSlug]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { fromZonedTime } from "date-fns-tz";
import OtpFlow from "@/components/OtpFlow";
import { toE164 } from "@/lib/phone";
import { AvailabilityResult } from "@/types/availability";

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
): Promise<AvailabilityResult> {
  const params = new URLSearchParams({
    locationSlug,
    date,
    kind: partyKind,
    includeSlots: "true",
    includeFreeBays: "true",
  });
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
  const searchParams = useSearchParams();
  const locationSlug = String(params?.locationSlug ?? "");
  const isAdminMode = searchParams.get("admin") === "1";

  const today = useMemo(() => new Date(), []);
  const todayYMD = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const [date, setDate] = useState(todayYMD);
  const [partyKind, setPartyKind] = useState<"SINGLE" | "GROUP">("GROUP");
  const [handedness, setHandedness] = useState<"RH" | "LH">("RH");
  const [duration, setDuration] = useState<number>(60);
  const [startTime, setStartTime] = useState<string>("");
  const [selectedBay, setSelectedBay] = useState<number | null>(null);
  const [preferSpecificBay, setPreferSpecificBay] = useState(false);

  const [locationName, setLocationName] = useState("");
  const [locationTz, setLocationTz] = useState<string>("");
  const [adminNote, setAdminNote] = useState("");
  const [passUrl, setPassUrl] = useState<string | null>(null);
  const [minDuration, setMinDuration] = useState<number>(30);
  const [maxDuration, setMaxDuration] = useState<number>(120);

  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [phoneErr, setPhoneErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<any>(null);

  // Track verified phone
  const [verifiedPhone, setVerifiedPhone] = useState<string>("");

  // Load location info
  useEffect(() => {
    if (!locationSlug) return;
    let cancelled = false;
    (async () => {
      try {
        const info = await fetchLocationInfo(locationSlug);
        if (!cancelled) {
          setLocationName(info.name || locationSlug);
          setLocationTz(info.timezone || "America/New_York");
          setAdminNote(info.bookingNote || "");
          setPassUrl(info.passAccessUrl ?? null);
          setMinDuration(info.minBookingMinutes ?? 30);
          setMaxDuration(info.maxBookingMinutes ?? 120);
        }
      } catch {
        if (!cancelled) setLocationName(locationSlug);
      }
    })();
    return () => { cancelled = true; };
  }, [locationSlug]);

  // Allowed durations
  const allowedDurations = useMemo(() => {
    const durations: number[] = [];
    const start = Math.max(minDuration, 30);
    for (let d = start; d <= maxDuration; d += 30) durations.push(d);
    return durations.length > 0 ? durations : [60];
  }, [minDuration, maxDuration]);

  useEffect(() => {
    if (!allowedDurations.includes(duration)) {
      const closest = allowedDurations.reduce((a, b) =>
        Math.abs(b - duration) < Math.abs(a - duration) ? b : a
      );
      setDuration(closest);
      setStartTime("");
      setSelectedBay(null);
    }
  }, [duration, allowedDurations]);

  // Load availability
  const loadAvailability = async () => {
    if (!locationSlug || !date) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchAvailability(locationSlug, date, partyKind, partyKind === "SINGLE" ? handedness : "");
      setAvailability(data);
      setStartTime("");
      setSelectedBay(null);
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

  // Available times & bays
  const availableStartTimes = useMemo(() => {
    if (!availability?.startTimes) return [];
    const times = availability.startTimes[duration as 30 | 60 | 90 | 120] || [];
    if (date === todayYMD) {
      const now = new Date();
      const cutoff = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      return times.filter((t) => t >= cutoff);
    }
    return times;
  }, [availability, duration, date, todayYMD]);

  const freeBaysAtSelectedTime = useMemo(() => {
    if (!startTime || !availability?.freeBaysBySlot || !locationTz) return [];
    const startLocal = new Date(`${date}T${startTime}:00`);
    const startUTC = fromZonedTime(startLocal, locationTz).toISOString();
    const key = `${startUTC}|${duration}`;
    return availability.freeBaysBySlot[key] || [];
  }, [startTime, availability?.freeBaysBySlot, date, duration, locationTz]);

  useEffect(() => {
    if (freeBaysAtSelectedTime.length > 0) {
      if (!preferSpecificBay) {
        setSelectedBay(freeBaysAtSelectedTime[0]);
      } else if (selectedBay && !freeBaysAtSelectedTime.includes(selectedBay)) {
        setSelectedBay(null);
      }
    }
  }, [freeBaysAtSelectedTime, preferSpecificBay]);

  const baysAvailableAtTime = freeBaysAtSelectedTime.length;

  // Move to verification step and SEND CODE IMMEDIATELY
  const goToVerification = () => {
    setEmailErr("");
    setPhoneErr("");
    setError("");

    if (!isValidEmail(email)) return setEmailErr("Valid email required");
    if (!isValidPhone(phone)) return setPhoneErr("10 digits required");

    const normalized = toE164(phone);
    if (!normalized) return setPhoneErr("Invalid phone number");

    setVerifiedPhone("");
    setStep(3);

    // Automatically send the first OTP when entering step 3
    fetch("/api/bookings/otp/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: normalized }),
    }).catch(console.error);
  };

  // Final booking after OTP success
  const finalizeBooking = async (phone: string) => {
    if (!phone) { return };

    setSubmitting(true);
    setError("");

    try {
      // Build local datetime strings (no timezone conversion yet)
      const [year, month, day] = date.split("-");
      const [hour, minute] = startTime.split(":");

      const startLocal = `${year}-${month}-${day}T${hour}:${minute}:00`;
      const endLocal = new Date(
        new Date(`${year}-${month}-${day}T${hour}:${minute}:00`).getTime() + duration * 60 * 1000
      );

      // Format endLocal as YYYY-MM-DDTHH:mm:00 in local time
      const endLocalStr = `${endLocal.getFullYear()}-${String(endLocal.getMonth() + 1).padStart(2, "0")}-${String(endLocal.getDate()).padStart(2, "0")}T${String(endLocal.getHours()).padStart(2, "0")}:${String(endLocal.getMinutes()).padStart(2, "0")}:00`;

      const payload: any = {
        locationSlug,
        startISO: startLocal,
        endISO: endLocalStr,
        firstName,
        lastName,
        phone,
        email,
        partyKind,
        handedness: partyKind === "SINGLE" ? handedness : undefined,
        source: isAdminMode ? "ADMIN" : "PUBLIC",
        bayNumber: selectedBay,
      };

      const { booking } = await createBooking(payload);
      setConfirmed(booking);
      setStep(4);
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
      {isAdminMode && (
        <div className="mb-4 p-3 bg-purple-100 border border-purple-300 rounded-lg text-purple-900 text-sm">
          Admin Mode Active
        </div>
      )}

      {confirmed ? (
        /* CONFIRMED STATE */
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

          {/* Progress Bar */}
          <div className="flex gap-2 mb-8">
            <div className={`h-2 flex-1 rounded-full ${step >= 1 ? "bg-black" : "bg-gray-300"}`} />
            <div className={`h-2 flex-1 rounded-full ${step >= 2 ? "bg-black" : "bg-gray-300"}`} />
            <div className={`h-2 flex-1 rounded-full ${step >= 3 ? "bg-black" : "bg-gray-300"}`} />
          </div>

          {/* STEP 1: Select Time & Bay */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2">Date</label>
                <input type="date" min={todayYMD} value={date} onChange={e => setDate(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Playing As</label>
                  <select value={partyKind} onChange={e => { setPartyKind(e.target.value as any); setStartTime(""); }}
                    className="w-full rounded-xl border border-gray-300 px-4 py-3">
                    <option value="GROUP">Group</option>
                    <option value="SINGLE">Single</option>
                  </select>
                </div>
                {partyKind === "SINGLE" && (
                  <div>
                    <label className="block text-sm font-medium mb-2">Handedness</label>
                    <select value={handedness} onChange={e => { setHandedness(e.target.value as any); setStartTime(""); }}
                      className="w-full rounded-xl border border-gray-300 px-4 py-3">
                      <option value="RH">Right-handed</option>
                      <option value="LH">Left-handed</option>
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-3">
                  Duration ({minDuration}–{maxDuration} min)
                </label>
                <div className="grid grid-cols-4 gap-3">
                  {allowedDurations.map(d => (
                    <button key={d} onClick={() => { setDuration(d); setStartTime(""); setSelectedBay(null); }}
                      className={`rounded-lg border py-3 text-sm font-medium transition ${duration === d ? "bg-black text-white border-black" : "border-gray-300 hover:border-gray-500"}`}>
                      {d} min
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Start Time {baysAvailableAtTime > 0 && `(${baysAvailableAtTime} bay${baysAvailableAtTime > 1 ? "s" : ""} free)`}
                </label>
                <select value={startTime} onChange={e => { setStartTime(e.target.value); setSelectedBay(null); }}
                  disabled={loading || availableStartTimes.length === 0}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 disabled:opacity-50">
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

              {/* Bay Selection with Smart Toggle */}
              {freeBaysAtSelectedTime.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Choose a specific bay?</label>
                    <button
                      type="button"
                      onClick={() => setPreferSpecificBay(!preferSpecificBay)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${preferSpecificBay ? "bg-black" : "bg-gray-300"}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${preferSpecificBay ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </div>

                  {!preferSpecificBay ? (
                    <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-800">
                      <strong>We'll assign you Bay {freeBaysAtSelectedTime[0]}</strong>
                      <br />
                      <span className="text-green-700">Best available</span>
                    </div>
                  ) : (
                    <div>
                      <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
                        {freeBaysAtSelectedTime.map(bay => (
                          <button
                            key={bay}
                            onClick={() => setSelectedBay(bay)}
                            className={`rounded-lg border py-3 text-sm font-medium transition ${
                              selectedBay === bay ? "bg-black text-white border-black" : "border-gray-300 hover:border-gray-500"
                            }`}
                          >
                            Bay {bay}
                          </button>
                        ))}
                      </div>
                      {!selectedBay && <p className="text-sm text-red-600 mt-2">Please select a bay</p>}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={() => setStep(2)}
                disabled={!startTime || (preferSpecificBay && !selectedBay)}
                className="w-full bg-black text-white py-4 rounded-xl font-medium disabled:opacity-40"
              >
                Continue to Contact
              </button>
            </div>
          )}

          {/* STEP 2: Contact Info */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="text-lg font-medium mb-4">
                {date} • {new Date(`${date}T${startTime}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} –{" "}
                {new Date(new Date(`${date}T${startTime}`).getTime() + duration * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}{" "}
                ({duration} min)
                {selectedBay && ` • Bay ${selectedBay}`}
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
                  onChange={(e) => { setPhone(formatPhone(e.target.value)); phoneErr && setPhoneErr(""); }}
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
                  onChange={(e) => { setEmail(e.target.value); emailErr && setEmailErr(""); }}
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
                  onClick={goToVerification}
                  disabled={!firstName || !lastName || !phone || !email || !!emailErr || !!phoneErr}
                  className="flex-1 bg-black text-white py-4 rounded-xl disabled:opacity-40 font-medium"
                >
                  Confirm Booking
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Phone Verification */}
          {step === 3 && (
            <div className="grid min-h-[70vh] place-items-center py-12">
              <div className="w-full max-w-sm">
                <div className="text-center mb-10">
                  <h2 className="text-2xl font-bold">Verify Your Phone</h2>
                  <p className="mt-3 text-lg text-neutral-600">
                    We sent a 6-digit code to<br />
                    <strong className="text-black">{phone}</strong>
                  </p>
                </div>

                <OtpFlow
                  title=""
                  subtitle=""
                  initialPhone={toE164(phone)}
                  startEndpoint="/api/bookings/otp/start"
                  verifyEndpoint="/api/bookings/otp/verify"
                  sendButtonText="Resend Code"
                  onSuccess={() => {
                    setVerifiedPhone(toE164(phone));
                    finalizeBooking(toE164(phone));
                  }}
                />

                <button
                  onClick={() => setStep(2)}
                  className="mt-8 w-full border border-gray-400 py-3 rounded-xl text-sm font-medium hover:bg-gray-50"
                >
                  ← Change Phone Number
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}