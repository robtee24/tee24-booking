"use client";

import React, { useEffect, useMemo, useState } from "react";
import { fromZonedTime } from "date-fns-tz";
import { toE164 } from "@/lib/phone";
import { AvailabilityResult } from "@/types/availability";
import { bookingDurationOptions, formatDurationMinutes } from "@/lib/booking-rules";
import type { BookingAccess } from "@/services/mobile-booking-access.service";

type Identity = {
  phone: string;
  phoneToken: string;
  member: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null } | null;
  access: BookingAccess | null;
  guest: {
    extraFeeCents: number;
    unauthorizedFeeCents: number;
    gilmorePlanId: string | null;
    gilmoreName: string;
    gilmorePriceCents: number;
    gilmoreGuestTiers: number[];
    gilmoreMaxGuests: number;
    signupPath: string;
    plans: { id: string; name: string; productType: string; priceCents: number }[];
  };
};

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

function todayYMD() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function BookingWizard({ locationSlug }: { locationSlug: string }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [code, setCode] = useState("");
  const [otpStep, setOtpStep] = useState<"phone" | "code">("phone");
  const [otpMsg, setOtpMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [locationName, setLocationName] = useState(locationSlug);
  const [locationTz, setLocationTz] = useState("America/New_York");
  const [minDuration, setMinDuration] = useState(60);
  const [maxDuration, setMaxDuration] = useState(180);
  const [durationStep, setDurationStep] = useState(60);
  const [note, setNote] = useState("");

  const [date, setDate] = useState(todayYMD);
  const [players, setPlayers] = useState(1);
  const [handedness, setHandedness] = useState<"RH" | "LH">("RH");
  const [duration, setDuration] = useState(60);
  const [startTime, setStartTime] = useState("");
  const [selectedBay, setSelectedBay] = useState<number | null>(null);
  const [changeBay, setChangeBay] = useState(false);
  const [playingWithMembers, setPlayingWithMembers] = useState(false);
  const [companionPhones, setCompanionPhones] = useState<string[]>([""]);
  const [paidExtras, setPaidExtras] = useState(0);

  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<Record<string, unknown> | null>(null);

  const kind: "SINGLE" | "GROUP" = players <= 1 ? "SINGLE" : "GROUP";
  const durations = useMemo(() => bookingDurationOptions(minDuration, maxDuration, durationStep), [minDuration, maxDuration, durationStep]);
  const included = identity?.access?.guests.included ?? 0;
  const guestsBeyondMember = Math.max(0, players - 1);
  const companionCount = playingWithMembers ? companionPhones.filter((p) => p.replace(/\D/g, "").length >= 10).length : 0;
  const unauthorized = identity?.member ? Math.max(0, guestsBeyondMember - included - companionCount - paidExtras) : 0;

  useEffect(() => {
    if (!locationSlug) return;
    let cancelled = false;
    fetch(`/api/location-info?locationSlug=${encodeURIComponent(locationSlug)}`)
      .then((r) => r.json())
      .then((info) => {
        if (cancelled) return;
        setLocationName(info.name || locationSlug);
        setLocationTz(info.timezone || "America/New_York");
        setNote(info.bookingNote || "");
        setMinDuration(info.minBookingMinutes ?? 60);
        setMaxDuration(info.maxBookingMinutes ?? 180);
        setDurationStep(info.bookingDurationStepMinutes ?? 60);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [locationSlug]);

  useEffect(() => {
    if (!identity || !locationSlug || !date) return;
    let cancelled = false;
    setBusy(true);
    const q = new URLSearchParams({ locationSlug, date, kind, includeFreeBays: "true" });
    if (kind === "SINGLE") q.set("hand", handedness);
    fetch(`/api/availability?${q}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setAvailability(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load times");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [identity, locationSlug, date, kind, handedness]);

  const startTimes = availability?.startTimes?.[duration] ?? [];
  const slotKey = startTime
    ? `${fromZonedTime(`${date}T${startTime}:00`, locationTz).toISOString()}|${duration}`
    : "";
  const freeBays = (slotKey && availability?.freeBaysBySlot?.[slotKey]) || [];

  useEffect(() => {
    if (!startTime) {
      setSelectedBay(null);
      return;
    }
    if (selectedBay && freeBays.includes(selectedBay)) return;
    setSelectedBay(freeBays[0] ?? null);
    setChangeBay(false);
  }, [startTime, freeBays, selectedBay]);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setOtpMsg(null);
    let phone: string;
    try {
      phone = toE164(phoneInput);
    } catch {
      return setOtpMsg("Enter a valid mobile number");
    }
    setBusy(true);
    try {
      const res = await fetch("/api/bookings/otp/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't send a code");
      setOtpStep("code");
      setOtpMsg(`We texted a 6-digit code to ${phone}`);
    } catch (err) {
      setOtpMsg(err instanceof Error ? err.message : "Couldn't send a code");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setOtpMsg(null);
    const digits = code.replace(/\D/g, "").slice(0, 6);
    if (digits.length !== 6) return setOtpMsg("Enter the 6-digit code");
    let phone: string;
    try {
      phone = toE164(phoneInput);
    } catch {
      return setOtpMsg("Enter a valid mobile number");
    }
    setBusy(true);
    try {
      const res = await fetch("/api/bookings/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: digits, locationSlug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That code didn't work");
      setIdentity({
        phone: data.phone,
        phoneToken: data.phoneToken,
        member: data.member,
        access: data.access,
        guest: data.guest,
      });
    } catch (err) {
      setOtpMsg(err instanceof Error ? err.message : "That code didn't work");
    } finally {
      setBusy(false);
    }
  }

  async function submitMember() {
    if (!identity?.member || !startTime || !selectedBay) return;
    setSubmitting(true);
    setError("");
    try {
      const startLocal = `${date}T${startTime}:00`;
      const end = new Date(new Date(startLocal).getTime() + duration * 60_000);
      const endLocal = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}T${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}:00`;
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationSlug,
          startISO: startLocal,
          endISO: endLocal,
          firstName: identity.member.firstName,
          lastName: identity.member.lastName,
          phone: identity.phone,
          email: identity.member.email,
          partyKind: kind,
          handedness: kind === "SINGLE" ? handedness : undefined,
          bayNumber: selectedBay,
          memberId: identity.member.id,
          phoneToken: identity.phoneToken,
          guestCount: guestsBeyondMember,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Couldn't complete the reservation");
      setConfirmed(json.booking);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't complete the reservation");
    } finally {
      setSubmitting(false);
    }
  }

  function guestSignupHref() {
    if (!identity) return "#";
    const guestsOnPass = Math.min(Math.max(0, players - 1), identity.guest.gilmoreMaxGuests);
    const params = new URLSearchParams({
      from: "booking",
      plan: identity.guest.gilmorePlanId ?? "",
      guests: String(guestsOnPass),
      phone: identity.phone,
      date,
      time: startTime,
      duration: String(duration),
      bay: String(selectedBay ?? ""),
      players: String(players),
      kind,
      hand: handedness,
    });
    return `${identity.guest.signupPath}?${params}`;
  }

  if (confirmed) {
    const c = confirmed as { email?: string; bayNumber?: number; startLocal?: string };
    return (
      <div className="mx-auto max-w-xl px-6 py-10">
        <h1 className="text-apple-3xl font-semibold tracking-tight">You're booked</h1>
        <p className="mt-2 text-apple-base text-apple-text-secondary">
          {locationName}
          {c.bayNumber ? ` · Bay ${c.bayNumber}` : ""}
          {startTime ? ` · ${date} at ${startTime}` : ""}
        </p>
        {c.email && <p className="mt-1 text-apple-sm text-apple-text-tertiary">Confirmation sent to {c.email}</p>}
      </div>
    );
  }

  if (!identity) {
    return (
      <div className="mx-auto max-w-md px-6 py-10">
        <h1 className="text-apple-3xl font-semibold tracking-tight">Reserve a bay</h1>
        <p className="mt-2 text-apple-base text-apple-text-secondary">
          Start with your mobile number. We'll see if you're a member and take it from there.
        </p>
        {otpMsg && (
          <div className={`mt-4 rounded-apple-sm px-4 py-3 text-apple-sm ${otpMsg.toLowerCase().includes("code") && !otpMsg.toLowerCase().includes("didn't") ? "bg-apple-green/5 text-apple-green" : "bg-apple-red/5 text-apple-red"}`}>
            {otpMsg}
          </div>
        )}
        {otpStep === "phone" ? (
          <form onSubmit={sendCode} className="mt-6 space-y-4">
            <label className="block text-apple-sm font-medium">Mobile number</label>
            <input className="input" type="tel" inputMode="tel" value={phoneInput} onChange={(e) => setPhoneInput(formatPhone(e.target.value))} placeholder="(502) 555-0100" />
            <button className="btn-primary w-full !py-3" disabled={busy} type="submit">
              {busy ? "Sending…" : "Text me a code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="mt-6 space-y-4">
            <label className="block text-apple-sm font-medium">6-digit code</label>
            <input className="input text-center text-2xl tracking-widest" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            <button className="btn-primary w-full !py-3" disabled={busy} type="submit">
              {busy ? "Checking…" : "Continue"}
            </button>
            <button className="btn-secondary w-full" type="button" disabled={busy} onClick={sendCode}>
              Resend code
            </button>
          </form>
        )}
      </div>
    );
  }

  const isMember = Boolean(identity.member && identity.access?.eligible);
  // Guests declared at signup are priced on the day-pass tiers ($15 / $10 / $5); anyone beyond the
  // pass's guest cap is an unauthorized guest at the flat fee. Mirrors guestCentsFor() on the server.
  const companions = Math.max(0, players - 1);
  const declaredGuests = Math.min(companions, identity.guest.gilmoreMaxGuests);
  const overflowGuests = companions - declaredGuests;
  const declaredGuestCents = identity.guest.gilmoreGuestTiers.slice(0, declaredGuests).reduce((s, c) => s + c, 0);
  const guestTotal = identity.guest.gilmorePriceCents + declaredGuestCents + overflowGuests * identity.guest.unauthorizedFeeCents;

  return (
    <div className="mx-auto max-w-xl space-y-6 px-6 py-10">
      <div>
        <p className="text-apple-xs font-medium uppercase tracking-wide text-apple-text-tertiary">{locationName}</p>
        <h1 className="mt-1 text-apple-3xl font-semibold tracking-tight">{isMember ? `Welcome back, ${identity.member!.firstName}` : "Book as a guest"}</h1>
        <p className="mt-2 text-apple-sm text-apple-text-secondary">
          {isMember
            ? identity.access?.message
            : "We'll hold the bay after you finish guest signup. The Gilmore day pass is already picked for this visit."}
        </p>
      </div>

      {note && <div className="rounded-apple bg-apple-text p-4 text-apple-sm text-white">{note}</div>}
      {error && <div className="rounded-apple-sm bg-apple-red/5 px-4 py-3 text-apple-sm text-apple-red">{error}</div>}

      <label className="block space-y-1.5">
        <span className="text-apple-sm font-medium">Date</span>
        <input className="input" type="date" min={todayYMD()} value={date} onChange={(e) => { setDate(e.target.value); setStartTime(""); }} />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-apple-sm font-medium">How many players?</legend>
        <div className="grid grid-cols-6 gap-2">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button key={n} type="button" onClick={() => { setPlayers(n); setStartTime(""); }} className={`rounded-apple-sm border py-2 text-apple-sm font-medium ${players === n ? "border-apple-blue bg-apple-blue text-white" : "border-apple-border"}`}>
              {n}
            </button>
          ))}
        </div>
        {players === 1 ? (
          <p className="text-apple-sm text-apple-text-secondary">You'll be assigned to a single bay. Single bays let us make the most of the facility.</p>
        ) : (
          <p className="text-apple-sm text-apple-text-secondary">You'll be assigned to a group bay so everyone in your party can play together.</p>
        )}
      </fieldset>

      {kind === "SINGLE" && (
        <fieldset className="space-y-2">
          <legend className="text-apple-sm font-medium">Which hand do you play?</legend>
          <div className="grid grid-cols-2 gap-2">
            {(["RH", "LH"] as const).map((h) => (
              <button key={h} type="button" onClick={() => { setHandedness(h); setStartTime(""); }} className={`rounded-apple-sm border py-2.5 text-apple-sm font-medium ${handedness === h ? "border-apple-blue bg-apple-blue text-white" : "border-apple-border"}`}>
                {h === "RH" ? "Right-handed" : "Left-handed"}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="space-y-2">
        <legend className="text-apple-sm font-medium">How long?</legend>
        <div className="grid grid-cols-3 gap-2">
          {durations.map((d) => (
            <button key={d} type="button" onClick={() => { setDuration(d); setStartTime(""); }} className={`rounded-apple-sm border py-2.5 text-apple-sm font-medium ${duration === d ? "border-apple-blue bg-apple-blue text-white" : "border-apple-border"}`}>
              {formatDurationMinutes(d)}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block space-y-1.5">
        <span className="text-apple-sm font-medium">Start time</span>
        <select className="input" value={startTime} disabled={busy || startTimes.length === 0} onChange={(e) => setStartTime(e.target.value)}>
          <option value="">{busy ? "Loading times…" : startTimes.length ? "Pick a start time" : "No times open for this duration"}</option>
          {startTimes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>

      {startTime && selectedBay && (
        <div className="rounded-apple border border-apple-divider bg-white p-4">
          <p className="text-apple-sm text-apple-text-secondary">You'll be on</p>
          <p className="text-apple-xl font-semibold">Bay {selectedBay}</p>
          {freeBays.length > 1 && !changeBay && (
            <button type="button" className="mt-2 text-apple-sm font-medium text-apple-blue" onClick={() => setChangeBay(true)}>
              Change bay
            </button>
          )}
          {changeBay && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {freeBays.map((n) => (
                <button key={n} type="button" onClick={() => setSelectedBay(n)} className={`rounded-apple-sm border py-2 text-apple-sm ${selectedBay === n ? "border-apple-blue bg-apple-blue text-white" : "border-apple-border"}`}>
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isMember && guestsBeyondMember > included && (
        <div className="space-y-3 rounded-apple border border-amber-200 bg-amber-50 p-4">
          <p className="text-apple-sm text-amber-950">
            Your membership covers you{included ? ` plus ${included} guest${included === 1 ? "" : "s"}` : " only"}. This reservation has {guestsBeyondMember} other {guestsBeyondMember === 1 ? "player" : "players"}.
          </p>
          <label className="flex items-center gap-2 text-apple-sm">
            <input type="checkbox" checked={playingWithMembers} onChange={(e) => setPlayingWithMembers(e.target.checked)} />
            I'm playing with other members
          </label>
          {playingWithMembers && companionPhones.map((p, i) => (
            <input key={i} className="input" placeholder="Member's mobile number" value={p} onChange={(e) => setCompanionPhones((prev) => prev.map((x, j) => (j === i ? formatPhone(e.target.value) : x)))} />
          ))}
          {playingWithMembers && (
            <button type="button" className="text-apple-sm font-medium text-apple-blue" onClick={() => setCompanionPhones((prev) => [...prev, ""])}>
              Add another member
            </button>
          )}
          <label className="block text-apple-sm">
            Extra paid guests
            <select className="input mt-1" value={paidExtras} onChange={(e) => setPaidExtras(Number(e.target.value))}>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>{n === 0 ? "None" : `${n} · ${money(n * (identity.access?.guests.extraFeeCents ?? 2500))} each`}</option>
              ))}
            </select>
          </label>
          <p className="text-apple-xs text-amber-900">A charge of {money(identity.guest.unauthorizedFeeCents)} per unauthorized guest will be charged to your account.</p>
          {unauthorized > 0 && (
            <p className="text-apple-sm font-medium text-amber-950">{unauthorized} unauthorized guest{unauthorized === 1 ? "" : "s"} · {money(unauthorized * identity.guest.unauthorizedFeeCents)}</p>
          )}
        </div>
      )}

      {startTime && selectedBay && isMember && (
        <button type="button" className="btn-primary w-full !py-3" disabled={submitting} onClick={submitMember}>
          {submitting ? "Booking…" : `Confirm Bay ${selectedBay} · ${startTime}`}
        </button>
      )}

      {startTime && selectedBay && !isMember && (
        <div className="space-y-3 rounded-apple border border-apple-divider bg-white p-4">
          <p className="text-apple-sm font-medium">Guest total before signup</p>
          <p className="text-apple-2xl font-semibold">{money(identity.guest.gilmorePriceCents)} <span className="text-apple-sm font-normal text-apple-text-secondary">{identity.guest.gilmoreName}</span></p>
          {declaredGuests > 0 && (
            <p className="text-apple-sm text-apple-text-secondary">
              {declaredGuests} guest{declaredGuests === 1 ? "" : "s"} · {money(declaredGuestCents)}
              <span className="text-apple-text-tertiary"> ({identity.guest.gilmoreGuestTiers.slice(0, declaredGuests).map((c) => money(c)).join(" / ")})</span>
            </p>
          )}
          {overflowGuests > 0 && (
            <p className="text-apple-sm text-amber-900">
              {overflowGuests} more than the pass allows · {money(overflowGuests * identity.guest.unauthorizedFeeCents)} at the unauthorized guest rate
            </p>
          )}
          <p className="text-apple-xs text-apple-text-tertiary">A charge of {money(identity.guest.unauthorizedFeeCents)} per unauthorized guest will be charged to your account.</p>
          <p className="text-apple-sm text-apple-text-secondary">Estimated today: {money(guestTotal)}. You'll pick or confirm The Gilmore on the next page — memberships are listed there too.</p>
          <a className="btn-primary block w-full !py-3 text-center" href={guestSignupHref()}>
            Continue to guest signup
          </a>
        </div>
      )}

      <button type="button" className="text-apple-sm text-apple-text-tertiary" onClick={() => setIdentity(null)}>
        Use a different number
      </button>
    </div>
  );
}
