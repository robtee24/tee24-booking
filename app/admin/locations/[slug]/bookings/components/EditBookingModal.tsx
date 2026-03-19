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

  const [selectedDateOnly, setSelectedDateOnly] = useState(editing.dateOnly);

  useEffect(() => {
    setSelectedDateOnly(editing.dateOnly);
  }, [editing.dateOnly]);

  const handleDateChange = (newDate: string) => {
    setSelectedDateOnly(newDate);
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
              value={editing.bayId}
              onChange={(e) => onFieldChange({ bayId: e.target.value })}
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
              value={editing.startHHMM}
              onChange={(e) => onFieldChange({ startHHMM: e.target.value })}
              className="input"
            >
              {timeOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Duration (minutes)</label>
            <input
              type="number"
              min={timeStep}
              step={timeStep}
              value={editing.duration}
              onChange={(e) => onFieldChange({ duration: Math.max(timeStep, Number(e.target.value) || timeStep) })}
              className="input"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <input placeholder="First Name *" value={editing.firstName} onChange={(e) => onFieldChange({ firstName: e.target.value })} className="input" />
          <input placeholder="Last Name" value={editing.lastName} onChange={(e) => onFieldChange({ lastName: e.target.value })} className="input" />
          <input placeholder="Email (optional)" value={editing.email} onChange={(e) => onFieldChange({ email: e.target.value })} className="input" />
          <input placeholder="Phone (optional)" value={editing.phone} onChange={(e) => onFieldChange({ phone: e.target.value })} className="input" />
        </div>

        <div className="flex justify-between items-center pt-5 border-t border-apple-divider">
          <button onClick={handleDelete} className="text-apple-red text-apple-sm font-medium hover:underline transition-colors">
            Delete Booking
          </button>
          <div className="flex gap-3">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              onClick={onSave}
              disabled={!editing.firstName.trim()}
              className="btn-primary"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
