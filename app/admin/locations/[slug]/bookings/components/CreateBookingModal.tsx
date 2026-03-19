// app/admin/locations/[slug]/bookings/components/CreateBookingModal.tsx
"use client";

import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { Bay } from "@/types/bay";

type TimeOption = { label: string; value: string };

type CreateBookingDraft = {
  bayId: string;
  dateOnly: string;
  startHHMM: string;
  startLocal: string;
  endLocal: string;
  duration: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

type CreateBookingModalProps = {
  open: boolean;
  onClose: () => void;
  draft: CreateBookingDraft | null;
  bays: Bay[];
  timeStep: number;
  timeOptions: TimeOption[];
  onUpdateDraft: (updates: Partial<CreateBookingDraft>) => void;
  onCreate: () => Promise<void>;
  getBlockedSlots: (bayId: string, dateOnly: string) => { startMins: number; endMins: number }[];
  isSlotBlocked: (startMins: number, durationMins: number, blockedSlots: any[]) => boolean;
};

export function CreateBookingModal({
  open,
  onClose,
  draft,
  bays,
  timeStep,
  timeOptions,
  onUpdateDraft,
  onCreate,
  getBlockedSlots,
  isSlotBlocked,
}: CreateBookingModalProps) {
  if (!draft) return null;

  const [selectedDateOnly, setSelectedDateOnly] = useState(draft.dateOnly);

  useEffect(() => {
    setSelectedDateOnly(draft.dateOnly);
  }, [draft.dateOnly]);

  const handleDateChange = (newDate: string) => {
    setSelectedDateOnly(newDate);
    const newStartLocal = `${newDate}T${draft.startHHMM}:00`;
    const newEndLocal = addMinutesToLocalISO(newStartLocal, draft.duration);
    onUpdateDraft({ dateOnly: newDate, startLocal: newStartLocal, endLocal: newEndLocal });
  };

  const blockedSlots = getBlockedSlots(draft.bayId, selectedDateOnly);

  const availableTimeOptions = timeOptions.filter((option) => {
    const [h, m] = option.value.split(":").map(Number);
    const startMins = h * 60 + m;
    return !isSlotBlocked(startMins, draft.duration, blockedSlots);
  });

  const handleStartTimeChange = (startHHMM: string) => {
    const startLocal = `${selectedDateOnly}T${startHHMM}:00`;
    const endLocal = addMinutesToLocalISO(startLocal, draft.duration);
    onUpdateDraft({ startHHMM, startLocal, endLocal });
  };

  const handleDurationChange = (minutes: number) => {
    const normalized = Math.max(timeStep, minutes || timeStep);
    const endLocal = addMinutesToLocalISO(draft.startLocal, normalized);
    onUpdateDraft({ duration: normalized, endLocal });
  };

  function addMinutesToLocalISO(localISO: string, minutes: number): string {
    const localDateStr = localISO.replace("T", " ").slice(0, 16);
    const date = new Date(localDateStr);
    date.setMinutes(date.getMinutes() + minutes);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mmm = String(date.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${mmm}:00`;
  }

  return (
    <Modal open={open} onClose={onClose} title="Create Booking">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">
              Date <span className="text-apple-red">*</span>
            </label>
            <input
              type="date"
              value={selectedDateOnly}
              onChange={(e) => handleDateChange(e.target.value)}
              className="input"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Bay</label>
            <select
              value={draft.bayId}
              onChange={(e) => onUpdateDraft({ bayId: e.target.value })}
              className="input"
            >
              {bays.map((b) => (
                <option key={b.id} value={b.id}>Bay {b.number}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Start Time</label>
            <select
              value={draft.startHHMM}
              onChange={(e) => handleStartTimeChange(e.target.value)}
              className="input"
            >
              {availableTimeOptions.length === 0 ? (
                <option disabled>No available slots</option>
              ) : (
                availableTimeOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))
              )}
            </select>
            {availableTimeOptions.length === 0 && (
              <p className="mt-1.5 text-apple-xs text-apple-orange">
                No available time slots for this bay and duration
              </p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Duration (minutes)</label>
            <input
              type="number"
              min={timeStep}
              step={timeStep}
              value={draft.duration}
              onChange={(e) => handleDurationChange(Number(e.target.value))}
              className="input"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <input placeholder="First Name *" value={draft.firstName} onChange={(e) => onUpdateDraft({ firstName: e.target.value })} className="input" />
          <input placeholder="Last Name" value={draft.lastName} onChange={(e) => onUpdateDraft({ lastName: e.target.value })} className="input" />
          <input placeholder="Email (optional)" value={draft.email} onChange={(e) => onUpdateDraft({ email: e.target.value })} className="input" />
          <input placeholder="Phone (optional)" value={draft.phone} onChange={(e) => onUpdateDraft({ phone: e.target.value })} className="input" />
        </div>

        <div className="flex justify-end gap-3 pt-5 border-t border-apple-divider">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={onCreate}
            disabled={!draft.firstName.trim() || availableTimeOptions.length === 0}
            className="btn-primary"
          >
            Create Booking
          </button>
        </div>
      </div>
    </Modal>
  );
}
