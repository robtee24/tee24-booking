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
  const [verifiedPhone, setVerifiedPhone] = useState<string>("");

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
    fetch("/api/bookings/otp/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: normalized }),
    }).catch(console.error);
  };

  const finalizeBooking = async (phone: string) => {
    if (!phone) return;
    setSubmitting(true);
    setError("");
    try {
      const [year, month, day] = date.split("-");
      const [hour, minute] = startTime.split(":");
      const startLocal = `${year}-${month}-${day}T${hour}:${minute}:00`;
      const endLocal = new Date(
        new Date(`${year}-${month}-${day}T${hour}:${minute}:00`).getTime() + duration * 60 * 1000
      );
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
    <div className="mx-auto max-w-3xl px-6 py-10 text-apple-text">
      {adminNote && (
        <div className="mb-6 rounded-apple-sm border border-apple-orange/30 bg-apple-orange/5 p-4 text-apple-sm text-apple-orange">
          {adminNote}
        </div>
      )}
      {isAdminMode && (
        <div className="mb-4 rounded-apple-sm border border-purple-300/30 bg-purple-50 p-3 text-apple-sm text-purple-800">
          Admin Mode Active
        </div>
      )}

      {confirmed ? (
        <div className="space-y-6">
          <div>
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-apple-green/10">
              <svg className="h-6 w-6 text-apple-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-apple-3xl font-semibold tracking-tight">Booking Confirmed!</h1>
            <p className="mt-1 text-apple-base text-apple-text-secondary">Confirmation sent to {confirmed.email}</p>
          </div>

          <div className="card p-6">
            <div className="grid grid-cols-2 gap-4 text-apple-sm">
              <div className="text-apple-text-secondary">Location</div><div className="font-medium">{confirmed.locationName}</div>
              <div className="text-apple-text-secondary">Bay</div><div className="font-medium">Bay {confirmed.bayNumber}</div>
              <div className="text-apple-text-secondary">Date & Time</div>
              <div className="font-medium">
                {new Date(confirmed.start).toLocaleDateString()} · {new Date(confirmed.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – {new Date(confirmed.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </div>
              <div className="text-apple-text-secondary">Name</div><div className="font-medium">{confirmed.firstName} {confirmed.lastName}</div>
            </div>
            <div className="mt-4 text-apple-xs text-apple-text-tertiary">ID: {confirmed.id}</div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => { setConfirmed(null); setStep(1); }} className="btn-secondary">
              Book Another
            </button>
            <a href={passUrl ?? "/passes"} target="_blank" rel="noreferrer" className="btn-primary ml-auto">
              Buy Access Pass
            </a>
          </div>
        </div>
      ) : (
        <>
          <h1 className="text-apple-3xl font-semibold tracking-tight mb-1">
            Book a Bay
          </h1>
          <p className="text-apple-base text-apple-text-secondary mb-8">
            {locationName || locationSlug}
          </p>

          {error && (
            <div className="mb-5 rounded-apple-sm border border-apple-red/30 bg-apple-red/5 p-4 text-apple-sm text-apple-red">
              {error}
            </div>
          )}

          {/* Progress Bar */}
          <div className="flex gap-2 mb-8">
            {[1, 2, 3].map((s) => (
              <div key={s} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${step >= s ? "bg-apple-blue" : "bg-apple-divider"}`} />
            ))}
          </div>

          {/* STEP 1 */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Date</label>
                <input type="date" min={todayYMD} value={date} onChange={e => setDate(e.target.value)} className="input" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Playing As</label>
                  <select value={partyKind} onChange={e => { setPartyKind(e.target.value as any); setStartTime(""); }} className="input">
                    <option value="GROUP">Group</option>
                    <option value="SINGLE">Single</option>
                  </select>
                </div>
                {partyKind === "SINGLE" && (
                  <div>
                    <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Handedness</label>
                    <select value={handedness} onChange={e => { setHandedness(e.target.value as any); setStartTime(""); }} className="input">
                      <option value="RH">Right-handed</option>
                      <option value="LH">Left-handed</option>
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-apple-sm font-medium text-apple-text">
                  Duration ({minDuration}–{maxDuration} min)
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {allowedDurations.map(d => (
                    <button key={d} onClick={() => { setDuration(d); setStartTime(""); setSelectedBay(null); }}
                      className={`rounded-apple-sm border py-2.5 text-apple-sm font-medium transition-all duration-200 ${duration === d ? "bg-apple-blue text-white border-apple-blue" : "border-apple-border text-apple-text-secondary hover:border-apple-text-tertiary"}`}>
                      {d} min
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">
                  Start Time {baysAvailableAtTime > 0 && <span className="text-apple-text-tertiary font-normal">({baysAvailableAtTime} bay{baysAvailableAtTime > 1 ? "s" : ""} free)</span>}
                </label>
                <select value={startTime} onChange={e => { setStartTime(e.target.value); setSelectedBay(null); }}
                  disabled={loading || availableStartTimes.length === 0} className="input disabled:opacity-50">
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

              {/* Bay Selection */}
              {freeBaysAtSelectedTime.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-apple-sm font-medium text-apple-text">Choose a specific bay?</label>
                    <button
                      type="button"
                      onClick={() => setPreferSpecificBay(!preferSpecificBay)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${preferSpecificBay ? "bg-apple-blue" : "bg-apple-border"}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${preferSpecificBay ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </div>

                  {!preferSpecificBay ? (
                    <div className="rounded-apple-sm border border-apple-green/30 bg-apple-green/5 p-4 text-apple-sm text-apple-green">
                      <strong>We&apos;ll assign you Bay {freeBaysAtSelectedTime[0]}</strong>
                      <br />
                      <span className="opacity-80">Best available</span>
                    </div>
                  ) : (
                    <div>
                      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                        {freeBaysAtSelectedTime.map(bay => (
                          <button
                            key={bay}
                            onClick={() => setSelectedBay(bay)}
                            className={`rounded-apple-sm border py-2.5 text-apple-sm font-medium transition-all duration-200 ${
                              selectedBay === bay ? "bg-apple-blue text-white border-apple-blue" : "border-apple-border text-apple-text-secondary hover:border-apple-text-tertiary"
                            }`}
                          >
                            Bay {bay}
                          </button>
                        ))}
                      </div>
                      {!selectedBay && <p className="text-apple-sm text-apple-red mt-2">Please select a bay</p>}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={() => setStep(2)}
                disabled={!startTime || (preferSpecificBay && !selectedBay)}
                className="btn-primary w-full !py-3.5 !text-base"
              >
                Continue to Contact
              </button>
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="card p-4 text-apple-sm text-apple-text-secondary">
                {date} · {new Date(`${date}T${startTime}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – {new Date(new Date(`${date}T${startTime}`).getTime() + duration * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ({duration} min)
                {selectedBay && ` · Bay ${selectedBay}`}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">First Name</label>
                  <input value={firstName} onChange={e => setFirstName(e.target.value)} className="input" placeholder="Jane" />
                </div>
                <div>
                  <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Last Name</label>
                  <input value={lastName} onChange={e => setLastName(e.target.value)} className="input" placeholder="Doe" />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Phone</label>
                <input
                  value={phone}
                  onChange={(e) => { setPhone(formatPhone(e.target.value)); phoneErr && setPhoneErr(""); }}
                  onBlur={() => !isValidPhone(phone) && setPhoneErr("10 digits required")}
                  className={`input ${phoneErr ? "!border-apple-red" : ""}`}
                  placeholder="(555) 123-4567"
                />
                {phoneErr && <p className="text-apple-red text-apple-xs mt-1">{phoneErr}</p>}
              </div>

              <div>
                <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); emailErr && setEmailErr(""); }}
                  onBlur={() => !isValidEmail(email) && setEmailErr("Valid email required")}
                  className={`input ${emailErr ? "!border-apple-red" : ""}`}
                  placeholder="jane@example.com"
                />
                {emailErr && <p className="text-apple-red text-apple-xs mt-1">{emailErr}</p>}
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="btn-secondary flex-1 !py-3.5">
                  Back
                </button>
                <button
                  onClick={goToVerification}
                  disabled={!firstName || !lastName || !phone || !email || !!emailErr || !!phoneErr}
                  className="btn-primary flex-1 !py-3.5"
                >
                  Confirm Booking
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div className="grid min-h-[70vh] place-items-center py-12">
              <div className="w-full max-w-sm">
                <div className="text-center mb-10">
                  <h2 className="text-apple-2xl font-semibold tracking-tight text-apple-text">Verify Your Phone</h2>
                  <p className="mt-3 text-apple-base text-apple-text-secondary">
                    We sent a 6-digit code to<br />
                    <strong className="text-apple-text">{phone}</strong>
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
                  className="btn-secondary mt-8 w-full"
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
