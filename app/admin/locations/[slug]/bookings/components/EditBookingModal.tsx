// app/admin/locations/[slug]/bookings/components/EditBookingModal.tsx
"use client";

import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { Bay } from "@/types/bay";

type EditBookingModalProps = {
  open: boolean;
  onClose: () => void;
  editing: {
    id: string;
    bayId: string;
    dateOnly: string;
    startHHMM: string;
    duration: number;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  } | null;
  bays: Bay[];
  timeStep: number;
  timeOptions: { label: string; value: string }[];
  onSave: () => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUpdateField: (updates: Partial<EditBookingModalProps["editing"]>) => void;
};

export function EditBookingModal({
  open,
  onClose,
  editing,
  bays,
  timeStep,
  timeOptions,
  onSave,
  onDelete,
  onUpdateField,
}: EditBookingModalProps) {
  if (!editing) return null;

  // Local state for selected date (allows changing date without affecting parent until save)
  const [selectedDateOnly, setSelectedDateOnly] = useState(editing.dateOnly);

  // Keep in sync if parent re-opens modal with different booking
  useEffect(() => {
    setSelectedDateOnly(editing.dateOnly);
  }, [editing.dateOnly]);

  const handleDateChange = (newDate: string) => {
    setSelectedDateOnly(newDate);
    // Update the dateOnly in parent state immediately so save uses correct date
    onUpdateField({ dateOnly: newDate });
  };

  const onFieldChange = (updates: Partial<EditBookingModalProps["editing"]>) => {
    onUpdateField(updates);
  };

  const handleDelete = async () => {
    if (confirm("Are you sure you want to delete this booking?")) {
      await onDelete(editing.id);
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit Booking" wide>
      <div className="space-y-5">
        {/* Date + Bay */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date <span className="text-red-600">*</span>
            </label>
            <input
              type="date"
              value={selectedDateOnly}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bay
            </label>
            <select
              value={editing.bayId}
              onChange={(e) => onFieldChange({ bayId: e.target.value })}
              className="w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
            >
              {bays.map((b) => (
                <option key={b.id} value={b.id}>
                  Bay {b.number}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Start Time + Duration */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start Time
            </label>
            <select
              value={editing.startHHMM}
              onChange={(e) => onFieldChange({ startHHMM: e.target.value })}
              className="w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
            >
              {timeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Duration (minutes)
            </label>
            <input
              type="number"
              min={timeStep}
              step={timeStep}
              value={editing.duration}
              onChange={(e) =>
                onFieldChange({
                  duration: Math.max(timeStep, Number(e.target.value) || timeStep),
                })
              }
              className="w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>
        </div>

        {/* Customer Info */}
        <div className="grid grid-cols-2 gap-4">
          <input
            placeholder="First Name *"
            value={editing.firstName}
            onChange={(e) => onFieldChange({ firstName: e.target.value })}
            className="rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
          />
          <input
            placeholder="Last Name"
            value={editing.lastName}
            onChange={(e) => onFieldChange({ lastName: e.target.value })}
            className="rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
          />
          <input
            placeholder="Email (optional)"
            value={editing.email}
            onChange={(e) => onFieldChange({ email: e.target.value })}
            className="rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
          />
          <input
            placeholder="Phone (optional)"
            value={editing.phone}
            onChange={(e) => onFieldChange({ phone: e.target.value })}
            className="rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>

        {/* Footer Actions */}
        <div className="flex justify-between items-center pt-4 border-t">
          <button
            onClick={handleDelete}
            className="text-red-600 font-medium hover:text-red-700 transition"
          >
            Delete Booking
          </button>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="rounded-xl border px-5 py-2.5 font-medium hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={!editing.firstName.trim()}
              className="rounded-xl bg-black text-white px-5 py-2.5 font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}