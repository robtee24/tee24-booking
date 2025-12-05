// app/admin/locations/[slug]/bookings/components/CreateBookingModal.tsx
"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import type { Bay } from "@/types/admin-booking";

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
  getBlockedSlots: (bayId: string) => { startMins: number; endMins: number }[];
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

  const blockedSlots = getBlockedSlots(draft.bayId);
  const availableTimeOptions = timeOptions.filter((option) => {
    const [h, m] = option.value.split(":").map(Number);
    const startMins = h * 60 + m;
    return !isSlotBlocked(startMins, draft.duration, blockedSlots);
  });

  const handleStartTimeChange = (startHHMM: string) => {
    const startLocal = `${draft.dateOnly}T${startHHMM}:00`;
    const endLocal = addMinutesToLocalISO(startLocal, draft.duration);
    onUpdateDraft({ startHHMM, startLocal, endLocal });
  };

  const handleDurationChange = (minutes: number) => {
    const normalized = Math.max(timeStep, minutes);
    const endLocal = addMinutesToLocalISO(draft.startLocal, normalized);
    onUpdateDraft({ duration: normalized, endLocal });
  };

  function addMinutesToLocalISO(localISO: string, minutes: number): string {
    // Ensure we treat the input as local time as local, not UTC
    const localDateStr = localISO.replace("T", " ").slice(0, 16);
    const date = new Date(localDateStr);
    date.setMinutes(date.getMinutes() + minutes);

    // Format back to YYYY-MM-DDTHH:mm:00
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
        {/* Bay + Start Time */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bay
            </label>
            <select
              value={draft.bayId}
              onChange={(e) => onUpdateDraft({ bayId: e.target.value })}
              className="w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
            >
              {bays.map((b) => (
                <option key={b.id} value={b.id}>
                  Bay {b.number}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start Time
            </label>
            <select
              value={draft.startHHMM}
              onChange={(e) => handleStartTimeChange(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
            >
              {availableTimeOptions.length === 0 ? (
                <option disabled>No available slots</option>
              ) : (
                availableTimeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))
              )}
            </select>
            {availableTimeOptions.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                No available time slots for this bay and duration
              </p>
            )}
          </div>
        </div>

        {/* Duration */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Duration (minutes)
          </label>
          <input
            type="number"
            min={timeStep}
            step={timeStep}
            value={draft.duration}
            onChange={(e) => handleDurationChange(Number(e.target.value) || timeStep)}
            className="w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>

        {/* Customer Info */}
        <div className="grid grid-cols-2 gap-4">
          <input
            placeholder="First Name *"
            value={draft.firstName}
            onChange={(e) => onUpdateDraft({ firstName: e.target.value })}
            className="rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
          />
          <input
            placeholder="Last Name"
            value={draft.lastName}
            onChange={(e) => onUpdateDraft({ lastName: e.target.value })}
            className="rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
          />
          <input
            placeholder="Email (optional)"
            value={draft.email}
            onChange={(e) => onUpdateDraft({ email: e.target.value })}
            className="rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
          />
          <input
            placeholder="Phone (optional)"
            value={draft.phone}
            onChange={(e) => onUpdateDraft({ phone: e.target.value })}
            className="rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button
            onClick={onClose}
            className="rounded-xl border px-5 py-2.5 font-medium hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={onCreate}
            disabled={!draft.firstName.trim() || availableTimeOptions.length === 0}
            className="rounded-xl bg-black text-white px-5 py-2.5 font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Create Booking
          </button>
        </div>
      </div>
    </Modal>
  );
}