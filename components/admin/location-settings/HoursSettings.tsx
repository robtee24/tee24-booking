"use client";

import React from "react";
import { useToast } from "@/components/ui/Toast";
import { Select } from "@/components/ui/Input";
import { SettingsSection, Toggle } from "./SettingsSection";
import type { DayHours, LocationSettings } from "./useLocationSettings";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function HoursSettings({
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
  const [open24, setOpen24] = React.useState(Boolean(data.open24Hours));
  const [rows, setRows] = React.useState<DayHours[]>(() => normalizeWeekHours(data.hours));
  const timeOptions = React.useMemo(() => buildTimeOptions(), []);

  React.useEffect(() => {
    if (editing) return;
    setOpen24(Boolean(data.open24Hours));
    setRows(normalizeWeekHours(data.hours));
  }, [data.open24Hours, data.hours, editing]);

  function cancel() {
    setEditing(false);
    setOpen24(Boolean(data.open24Hours));
    setRows(normalizeWeekHours(data.hours));
  }

  async function onSave() {
    try {
      await save({ open24Hours: open24, hours: open24 ? [] : sanitizeHours(rows) });
      setEditing(false);
      toast({ tone: "success", title: "Hours saved" });
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't save hours", description: e instanceof Error ? e.message : undefined });
    }
  }

  function updateRow(idx: number, patch: Partial<DayHours>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function copyToAll(idx: number) {
    const src = rows[idx];
    setRows((prev) => prev.map((r) => ({ ...r, closed: src.closed, open: src.open, close: src.close })));
  }

  return (
    <SettingsSection
      title="Hours of operation"
      description="Bookings can only be made inside these hours."
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancel={cancel}
      onSave={onSave}
      saving={saving}
    >
      {!editing ? (
        data.open24Hours ? (
          <p className="text-apple-sm text-apple-text">Open 24 hours, every day.</p>
        ) : (
          <ul className="divide-y divide-apple-divider rounded-apple-sm border border-apple-border">
            {normalizeWeekHours(data.hours).map((r) => (
              <li key={r.day} className="flex items-center justify-between px-3 py-2 text-apple-sm">
                <span className="font-medium text-apple-text">{DAY_NAMES[r.day]}</span>
                {r.closed ? (
                  <span className="text-apple-text-tertiary">Closed</span>
                ) : (
                  <span className="font-mono text-apple-text-secondary">
                    {fmt12(r.open)} – {fmt12(r.close)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="space-y-4">
          <Toggle checked={open24} onChange={setOpen24} label="Open 24 hours" hint="Ignore the weekly schedule below." />
          {!open24 && (
            <ul className="divide-y divide-apple-divider rounded-apple-sm border border-apple-border">
              {rows.map((r, idx) => (
                <li key={r.day} className="grid grid-cols-1 gap-2 px-3 py-3 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end">
                  <div className="flex items-center justify-between sm:block">
                    <div className="text-apple-sm font-medium text-apple-text">{DAY_NAMES[r.day]}</div>
                    <label className="flex items-center gap-2 text-apple-xs text-apple-text-secondary sm:mt-1">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-apple-blue"
                        checked={Boolean(r.closed)}
                        onChange={(e) => updateRow(idx, { closed: e.target.checked })}
                      />
                      Closed
                    </label>
                  </div>
                  {r.closed ? (
                    <div className="text-apple-sm text-apple-text-tertiary sm:col-span-2">Closed all day</div>
                  ) : (
                    <>
                      <Select label="Open" value={r.open ?? "09:00"} onChange={(e) => updateRow(idx, { open: e.target.value })}>
                        {timeOptions.map((t) => (
                          <option key={t} value={t}>{fmt12(t)}</option>
                        ))}
                      </Select>
                      <Select label="Close" value={r.close ?? "21:00"} onChange={(e) => updateRow(idx, { close: e.target.value })}>
                        {timeOptions.map((t) => (
                          <option key={t} value={t}>{fmt12(t)}</option>
                        ))}
                      </Select>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => copyToAll(idx)}
                    className="justify-self-start text-apple-xs font-medium text-apple-blue hover:underline sm:justify-self-end sm:pb-2.5"
                  >
                    Copy to all
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

/* ───────────────────────────── helpers ─────────────────────────────────── */

export function defaultWeekHours(): DayHours[] {
  return Array.from({ length: 7 }, (_, day) => ({ day, closed: false, open: "09:00", close: "21:00" }));
}

export function normalizeWeekHours(input?: DayHours[] | null): DayHours[] {
  const base = defaultWeekHours();
  if (!Array.isArray(input) || input.length === 0) return base;
  const byDay = new Map<number, DayHours>();
  for (const r of input) {
    if (r && typeof r.day === "number" && r.day >= 0 && r.day <= 6) {
      byDay.set(r.day, {
        day: r.day,
        closed: Boolean(r.closed),
        open: validTime(r.open) ? r.open! : "09:00",
        close: validTime(r.close) ? r.close! : "21:00",
      });
    }
  }
  return base.map((r) => byDay.get(r.day) ?? r);
}

export function sanitizeHours(rows: DayHours[]): DayHours[] {
  return rows.map((r) => ({
    day: r.day,
    closed: Boolean(r.closed),
    open: r.closed ? undefined : validTime(r.open) ? r.open : "09:00",
    close: r.closed ? undefined : validTime(r.close) ? r.close : "21:00",
  }));
}

function validTime(s?: string) {
  return typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
}

function buildTimeOptions(): string[] {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 30) out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  return out;
}

function fmt12(t?: string): string {
  if (!validTime(t)) return "—";
  const [h, m] = t!.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${suffix}`;
}
