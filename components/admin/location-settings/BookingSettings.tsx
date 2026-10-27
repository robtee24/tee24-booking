"use client";

import React from "react";
import { useToast } from "@/components/ui/Toast";
import { Input, Select } from "@/components/ui/Input";
import { SettingsSection, Field } from "./SettingsSection";
import { clampInt, type LocationSettings } from "./useLocationSettings";
import { formatDurationMinutes } from "@/lib/booking-rules";

const DURATIONS = Array.from({ length: 24 }, (_, i) => (i + 1) * 30);
const STEPS = [15, 30, 60, 90, 120];

function fmt(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h}h`;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function BookingSettings({
  data,
  saving,
  save,
}: {
  data: LocationSettings;
  saving: boolean;
  save: (patch: Partial<LocationSettings>) => Promise<LocationSettings>;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const fromData = React.useCallback(
    () => ({
      minBookingMinutes: clampInt(data.minBookingMinutes, 30, 720, 60),
      maxBookingMinutes: clampInt(data.maxBookingMinutes, 30, 720, 180),
      bookingDurationStepMinutes: clampInt(data.bookingDurationStepMinutes, 15, 180, 60),
      maxActiveBookingsPerGuest: clampInt(data.maxActiveBookingsPerGuest, 0, 20, 3),
      maxSimultaneousBookings: clampInt(data.maxSimultaneousBookings, 0, 5, 1),
      maxConsecutiveBookingsPerGuest: clampInt(data.maxConsecutiveBookingsPerGuest, 1, 10, 2),
      activeBookingIdentifyBy: (data.activeBookingIdentifyBy ?? "either") as "phone" | "email" | "either",
      activeBookingWindowHours: clampInt(data.activeBookingWindowHours, 1, 720, 24),
    }),
    [data]
  );
  const [d, setD] = React.useState(fromData);
  React.useEffect(() => {
    if (!editing) setD(fromData());
  }, [fromData, editing]);

  async function onSave() {
    if (d.minBookingMinutes > d.maxBookingMinutes) {
      return toast({ tone: "error", title: "Minimum duration must be at most the maximum" });
    }
    try {
      await save({ ...d });
      setEditing(false);
      toast({ tone: "success", title: "Booking settings saved" });
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't save settings", description: e instanceof Error ? e.message : undefined });
    }
  }

  const idLabel = { either: "Phone or email", email: "Email", phone: "Phone" } as const;

  return (
    <SettingsSection
      title="Booking rules"
      description="These limits apply to member and guest reservations at this club. Staff bookings in the schedule are not restricted."
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancel={() => setEditing(false)}
      onSave={onSave}
      saving={saving}
    >
      {!editing ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Min duration" value={fmt(d.minBookingMinutes)} />
          <Field label="Max duration" value={fmt(d.maxBookingMinutes)} />
          <Field label="Duration step" value={fmt(d.bookingDurationStepMinutes)} />
          <Field label="Active reservations" value={String(d.maxActiveBookingsPerGuest)} />
          <Field label="At the same time" value={d.maxSimultaneousBookings === 1 ? "1 bay" : String(d.maxSimultaneousBookings)} />
          <Field label="Back-to-back" value={String(d.maxConsecutiveBookingsPerGuest)} />
          <Field label="Identify by" value={idLabel[d.activeBookingIdentifyBy]} />
          <Field label="Count window" value={`${d.activeBookingWindowHours} hours`} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Minimum duration" value={d.minBookingMinutes} onChange={(e) => setD((p) => ({ ...p, minBookingMinutes: Number(e.target.value) }))}>
            {DURATIONS.map((m) => (
              <option key={m} value={m}>{fmt(m)}</option>
            ))}
          </Select>
          <Select label="Maximum duration" value={d.maxBookingMinutes} onChange={(e) => setD((p) => ({ ...p, maxBookingMinutes: Number(e.target.value) }))}>
            {DURATIONS.map((m) => (
              <option key={m} value={m}>{fmt(m)}</option>
            ))}
          </Select>
          <Select label="Duration increments" value={d.bookingDurationStepMinutes} onChange={(e) => setD((p) => ({ ...p, bookingDurationStepMinutes: Number(e.target.value) }))}>
            {STEPS.map((m) => (
              <option key={m} value={m}>{formatDurationMinutes(m)}</option>
            ))}
          </Select>
          <Input
            label="Max active reservations"
            hint="Upcoming reservations one person can hold at once. 0 turns this off."
            type="number"
            inputMode="numeric"
            min={0}
            max={20}
            value={d.maxActiveBookingsPerGuest}
            onChange={(e) => setD((p) => ({ ...p, maxActiveBookingsPerGuest: Number(e.target.value) }))}
          />
          <Input
            label="Max reservations at the same time"
            hint="1 means they can only play one bay at a time. 0 turns this off."
            type="number"
            inputMode="numeric"
            min={0}
            max={5}
            value={d.maxSimultaneousBookings}
            onChange={(e) => setD((p) => ({ ...p, maxSimultaneousBookings: Number(e.target.value) }))}
          />
          <Input
            label="Max back-to-back reservations"
            hint="How many reservations they can stack immediately after one another."
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            value={d.maxConsecutiveBookingsPerGuest}
            onChange={(e) => setD((p) => ({ ...p, maxConsecutiveBookingsPerGuest: Number(e.target.value) }))}
          />
          <Select label="Match people by" value={d.activeBookingIdentifyBy} onChange={(e) => setD((p) => ({ ...p, activeBookingIdentifyBy: e.target.value as "phone" | "email" | "either" }))}>
            <option value="either">Phone or email</option>
            <option value="phone">Phone</option>
            <option value="email">Email</option>
          </Select>
          <Input
            label="Active-reservation window (hours)"
            hint="How far ahead a reservation still counts toward the active limit. Used for reporting; the active count is every future reservation."
            type="number"
            inputMode="numeric"
            min={1}
            max={720}
            value={d.activeBookingWindowHours}
            onChange={(e) => setD((p) => ({ ...p, activeBookingWindowHours: Number(e.target.value) }))}
          />
        </div>
      )}
    </SettingsSection>
  );
}
