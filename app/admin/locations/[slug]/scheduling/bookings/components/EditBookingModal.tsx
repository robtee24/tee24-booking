// app/admin/locations/[slug]/bookings/components/EditBookingModal.tsx
"use client";

import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { Bay } from "@/types/bay";

const STATUS_BADGE_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  VISITOR: 'bg-blue-50 text-blue-700 border-blue-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
  FROZEN: 'bg-amber-50 text-amber-700 border-amber-200',
};

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
  memberStatus?: string | null;
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
  memberStatus,
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

        {memberStatus && (
          <div className="flex items-center gap-2">
            <span className="text-apple-sm text-apple-text-secondary">Gymdesk Status:</span>
            <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE_COLORS[memberStatus] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
              {memberStatus.toLowerCase()}
            </span>
          </div>
        )}

        {editing.phone && (
          <div className="pt-4 border-t border-apple-divider">
            <a
              href={`openphone://message?number=${editing.phone.replace(/[^+\d]/g, '')}`}
              className="inline-flex items-center gap-2 rounded-apple-sm border border-apple-border px-4 py-2.5 text-apple-sm font-medium text-apple-text transition-colors hover:bg-apple-fill-secondary"
            >
              <svg className="h-4 w-4 text-apple-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
              Message on Quo
            </a>
          </div>
        )}

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
