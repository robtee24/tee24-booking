"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, CalendarCheck, LineChart as LineIcon, Video, Home } from "lucide-react";
import { Badge } from "@/components/ui";

/* ───────────────────────────── API helper ─────────────────────────────── */

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/* ───────────────────────────── Formatters ─────────────────────────────── */

export const fmtDate = (d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) =>
  d ? new Date(d).toLocaleDateString("en-US", opts) : "—";
export const fmtShort = (d: string | Date | null | undefined) => fmtDate(d, { month: "short", day: "numeric" });
export const n1 = (v: number | null | undefined, unit = "") => (v == null || !Number.isFinite(v) ? "—" : `${Math.round(v * 10) / 10}${unit}`);
export const n0 = (v: number | null | undefined, unit = "") => (v == null || !Number.isFinite(v) ? "—" : `${Math.round(v)}${unit}`);
export const signed = (v: number | null | undefined, unit = "") => (v == null ? "—" : `${v > 0 ? "+" : ""}${Math.round(v * 10) / 10}${unit}`);

export const SOURCE_LABEL: Record<string, string> = { MANUAL: "Logged", GSPRO_CSV: "Launch monitor", BAY_APP: "Bay", SWING_VIDEO: "Swing video" };

/* ───────────────────────────── Shared types ───────────────────────────── */

export type Flag = { key: string; area: string; severity: number; club: string | null; title: string; detail: string; metric: string };

export type SessionRow = {
  id: string; source: string; playedAt: string; durationMin: number | null; title: string | null; notes: string | null; shotCount: number; fileName: string | null; createdAt: string;
  clubs: number; topFlags: { key: string; title: string; severity: number }[]; highlights: string[]; swingAnalysisId: string | null;
};

export type AnalysisSummary = {
  id: string; status: "PENDING" | "UPLOADED" | "DONE" | "ERROR" | "EXPIRED"; handedness: string; view: string; club: string | null; title: string | null; notes: string | null; error: string | null;
  seconds: number | null; recordedAt: string; completedAt: string | null; createdAt: string; sessionId: string | null; score: number | null; detectedView: string | null;
  thumbnail: string | null; topFeedback: { rule: string; title: string; severity: number }[]; feedbackCount: number;
};

/* ───────────────────────────── Sub-navigation ─────────────────────────── */

const ITEMS = [
  { href: "/portal/swing", label: "Overview", icon: Home, exact: true },
  { href: "/portal/swing/progress", label: "Progress", icon: LineIcon },
  { href: "/portal/swing/plan", label: "Practice plan", icon: CalendarCheck },
  { href: "/portal/swing/videos", label: "Swing videos", icon: Video },
];

export function SwingNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Swing Lab" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
      {ITEMS.map((it) => {
        const active = it.exact ? pathname === it.href : pathname?.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-apple-pill px-3 py-1.5 text-apple-sm font-medium transition-colors ${active ? "bg-apple-text text-white" : "bg-white text-apple-text-secondary ring-1 ring-apple-border hover:text-apple-text"}`}
            aria-current={active ? "page" : undefined}
          >
            <it.icon className="h-4 w-4" />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SwingHeader({ title = "Swing Lab", subtitle }: { title?: string; subtitle?: string }) {
  return (
    <div className="space-y-3">
      <div>
        <h1 className="flex items-center gap-2 text-apple-2xl font-semibold tracking-tight">
          <Activity className="h-6 w-6 text-apple-blue" />
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-apple-sm text-apple-text-secondary">{subtitle}</p>}
      </div>
      <SwingNav />
    </div>
  );
}

/* ───────────────────────────── Small pieces ───────────────────────────── */

export function severityTone(sev: number): "danger" | "warn" | "info" {
  // Launch-monitor flags are 0..1; swinglab feedback is 1..3.
  const s = sev > 1 ? sev / 3 : sev;
  return s >= 0.75 ? "danger" : s >= 0.45 ? "warn" : "info";
}

export function FlagList({ flags, compact = false }: { flags: Flag[]; compact?: boolean }) {
  if (!flags.length) return <p className="text-apple-sm text-apple-text-tertiary">No issues flagged — nice.</p>;
  return (
    <ul className={compact ? "space-y-1.5" : "space-y-3"}>
      {flags.map((f) => (
        <li key={`${f.key}-${f.club ?? ""}`} className={compact ? "flex items-start gap-2 text-apple-sm" : "rounded-apple-sm border border-apple-border p-3"}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={severityTone(f.severity)} size="sm">{f.club ?? f.area.replace(/_/g, " ")}</Badge>
            <span className="font-medium text-apple-text">{f.title}</span>
          </div>
          {!compact && <p className="mt-1 text-apple-sm text-apple-text-secondary">{f.detail}</p>}
        </li>
      ))}
    </ul>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-apple-sm border border-apple-border bg-white px-3 py-2">
      <div className="text-apple-xs text-apple-text-tertiary">{label}</div>
      <div className="text-apple-base font-semibold text-apple-text">{value}</div>
      {hint && <div className="text-apple-xs text-apple-text-tertiary">{hint}</div>}
    </div>
  );
}

export function StatusPill({ status }: { status: AnalysisSummary["status"] }) {
  const map: Record<AnalysisSummary["status"], { label: string; tone: "success" | "warn" | "danger" | "muted" | "info" }> = {
    DONE: { label: "Analyzed", tone: "success" },
    UPLOADED: { label: "Analyzing…", tone: "info" },
    PENDING: { label: "Waiting for upload", tone: "muted" },
    ERROR: { label: "Failed", tone: "danger" },
    EXPIRED: { label: "Expired", tone: "muted" },
  };
  const m = map[status];
  return <Badge tone={m.tone} size="sm">{m.label}</Badge>;
}

/** Read a File as base64 (no data: prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error("Couldn't read file"));
    r.readAsDataURL(file);
  });
}
