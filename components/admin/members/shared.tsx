"use client";

import React from "react";
export * from "./format";
import { initials } from "./format";

export type ApiError = Error & { status: number; data: Record<string, unknown> | null };

/** fetch JSON helper that throws the server's `error` message. */
export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    cache: "no-store",
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`) as ApiError;
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

export function errMsg(e: unknown, fallback = "Something went wrong"): string {
  return e instanceof Error ? e.message : fallback;
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

