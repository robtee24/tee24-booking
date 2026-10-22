"use client";

import React from "react";
import { Button } from "@/components/ui/Button";

/**
 * Card with an inline Edit → Save/Cancel affordance. Action buttons move
 * below the content on phones so they never crowd the title.
 */
export function SettingsSection({
  title,
  description,
  editing,
  onEdit,
  onCancel,
  onSave,
  saving,
  canEdit = true,
  children,
}: {
  title: string;
  description?: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
  saving: boolean;
  canEdit?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-apple border border-apple-divider bg-white p-4 shadow-apple sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-apple-lg font-semibold text-apple-text">{title}</h2>
          {description && <p className="mt-0.5 text-apple-sm text-apple-text-secondary">{description}</p>}
        </div>
        {canEdit && !editing && (
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Edit
          </Button>
        )}
      </div>

      {children}

      {editing && (
        <div className="mt-4 flex flex-col-reverse gap-2 border-t border-apple-divider pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void onSave()} loading={saving}>
            Save changes
          </Button>
        </div>
      )}
    </section>
  );
}

export function Field({ label, value, mono = false }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-apple-xs font-medium text-apple-text-tertiary">{label}</div>
      <div className={`mt-0.5 break-words text-apple-sm text-apple-text ${mono ? "font-mono" : ""}`}>
        {value === null || value === undefined || value === "" ? "—" : value}
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <span className="relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-apple-blue peer-focus-visible:ring-4 peer-focus-visible:ring-apple-blue/30" />
        <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-apple-sm font-medium text-apple-text">{label}</span>
        {hint && <span className="block text-apple-xs text-apple-text-tertiary">{hint}</span>}
      </span>
    </label>
  );
}
