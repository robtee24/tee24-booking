"use client";

import React from "react";

/** fetch JSON helper that throws the server's `error` message. */
export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    cache: "no-store",
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`) as Error & { status: number; data: any };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

export function errMsg(e: unknown, fallback = "Something went wrong"): string {
  return e instanceof Error ? e.message : fallback;
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function relTime(d: string | Date | null | undefined): string {
  if (!d) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 60) return `${days}d ago`;
  return fmtDate(d);
}

export function ageFromDob(dob: string | Date | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export function toDateInput(d: string | Date | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function todayInput(): string {
  return toDateInput(new Date());
}

export function initials(first?: string | null, last?: string | null): string {
  return `${(first ?? "").trim()[0] ?? ""}${(last ?? "").trim()[0] ?? ""}`.toUpperCase() || "?";
}

export function Avatar({ photoUrl, first, last, size = "md" }: { photoUrl?: string | null; first?: string | null; last?: string | null; size?: "sm" | "md" | "lg" | "xl" }) {
  const dim = { sm: "h-8 w-8 text-apple-xs", md: "h-10 w-10 text-apple-sm", lg: "h-14 w-14 text-apple-lg", xl: "h-20 w-20 text-apple-2xl" }[size];
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl} alt="" className={`${dim} shrink-0 rounded-full object-cover`} />;
  }
  return (
    <div className={`${dim} flex shrink-0 items-center justify-center rounded-full bg-apple-blue/10 font-semibold text-apple-blue`}>
      {initials(first, last)}
    </div>
  );
}

export function TagChip({ name, color, onRemove }: { name: string; color?: string | null; onRemove?: () => void }) {
  const c = color ?? "#16a34a";
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-apple-xs font-medium" style={{ backgroundColor: c + "20", color: c }}>
      {name}
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 rounded-full px-1 leading-none hover:bg-black/10" aria-label={`Remove tag ${name}`}>
          ×
        </button>
      )}
    </span>
  );
}

export function Checkbox({ label, checked, onChange, hint }: { label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-apple-sm text-apple-text">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-apple-blue" />
      <span>
        {label}
        {hint && <span className="block text-apple-xs text-apple-text-tertiary">{hint}</span>}
      </span>
    </label>
  );
}

export function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-apple-xs uppercase tracking-wide text-apple-text-tertiary">{label}</dt>
      <dd className="mt-0.5 text-apple-sm text-apple-text">{value ?? "—"}</dd>
    </div>
  );
}

export function LoadingRows({ n = 3 }: { n?: number }) {
  return (
    <div className="animate-pulse space-y-2">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-12 rounded-apple-sm bg-apple-fill-secondary" />
      ))}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-apple border border-apple-red/30 bg-apple-red/5 p-3 text-apple-sm text-apple-red sm:flex-row sm:items-center">
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="text-apple-xs font-semibold underline">
          Retry
        </button>
      )}
    </div>
  );
}

export const ACQUISITION_SOURCES = ["Walk-in", "Google", "Instagram", "Facebook", "TikTok", "Referral", "Event", "Flyer", "Corporate", "Website", "Other"];
export const GENDERS = [
  { value: "", label: "Prefer not to say" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "nonbinary", label: "Non-binary" },
  { value: "other", label: "Other" },
];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
