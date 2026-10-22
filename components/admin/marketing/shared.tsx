"use client";

// Small shared client helpers for the marketing/comms module.
import React from "react";
import { useAdminLocation } from "@/components/admin/LocationContext";
import { useToast } from "@/components/ui";

/** fetch() wrapper that appends ?slug= for the current location and throws on !ok. */
export function useMarketingApi() {
  const { slug } = useAdminLocation();
  return React.useCallback(
    async <T = unknown,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      const url = new URL(path, window.location.origin);
      if (!url.searchParams.has("slug")) url.searchParams.set("slug", slug);
      const { json, ...rest } = init ?? {};
      const res = await fetch(url.toString(), {
        ...rest,
        cache: "no-store",
        headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
        body: json !== undefined ? JSON.stringify(json) : rest.body,
      });
      const text = await res.text();
      let data: { error?: string } | null = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { error: text };
      }
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      return data as T;
    },
    [slug],
  );
}

export function useErrorToast() {
  const { toast } = useToast();
  return React.useCallback(
    (e: unknown, title = "Something went wrong") => {
      toast({ tone: "error", title, description: e instanceof Error ? e.message : String(e) });
    },
    [toast],
  );
}

export function Toggle({ checked, onChange, label, disabled, size = "md" }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean; size?: "sm" | "md" }) {
  const w = size === "sm" ? "h-5 w-9" : "h-6 w-11";
  const knob = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const shift = size === "sm" ? "translate-x-4" : "translate-x-5";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/30",
        w,
        checked ? "bg-apple-green" : "bg-apple-fill-tertiary",
        disabled ? "opacity-50" : "",
      ].join(" ")}
    >
      <span className={["inline-block transform rounded-full bg-white shadow transition-transform", knob, checked ? shift : "translate-x-0.5"].join(" ")} />
    </button>
  );
}

export function ChipToggle<T extends string>({ options, value, onChange, labelFor }: { options: readonly T[] | T[]; value: T[]; onChange: (v: T[]) => void; labelFor?: (v: T) => string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const sel = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(sel ? value.filter((x) => x !== o) : [...value, o])}
            className={`rounded-full border px-3 py-1 text-apple-xs transition-colors ${sel ? "border-apple-blue bg-apple-blue text-white" : "border-apple-border text-apple-text-secondary hover:bg-apple-fill-secondary"}`}
          >
            {labelFor ? labelFor(o) : o}
          </button>
        );
      })}
    </div>
  );
}

export function MultiSelectChips({ options, value, onChange, empty = "None available." }: { options: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; empty?: string }) {
  if (options.length === 0) return <span className="text-apple-xs text-apple-text-tertiary">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const sel = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(sel ? value.filter((x) => x !== o.id) : [...value, o.id])}
            className={`rounded-full border px-3 py-1 text-apple-xs transition-colors ${sel ? "border-apple-blue bg-apple-blue text-white" : "border-apple-border text-apple-text-secondary hover:bg-apple-fill-secondary"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Clickable merge-field chips that insert `{key}` at the caret of a target textarea/input. */
export function MergeFieldChips({ fields, targetRef, onInsert }: { fields: { key: string; label?: string }[]; targetRef?: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>; onInsert?: (token: string) => void }) {
  function insert(key: string) {
    const token = `{${key}}`;
    const el = targetRef?.current;
    if (el && typeof el.selectionStart === "number") {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const next = el.value.slice(0, start) + token + el.value.slice(end);
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
      setter?.call(el, next);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    } else onInsert?.(token);
  }
  return (
    <div className="flex flex-wrap gap-1">
      {fields.map((f) => (
        <button key={f.key} type="button" title={f.label} onClick={() => insert(f.key)} className="rounded-full border border-dashed border-apple-border px-2 py-0.5 font-mono text-[11px] text-apple-text-secondary hover:border-apple-blue hover:text-apple-blue">
          {`{${f.key}}`}
        </button>
      ))}
    </div>
  );
}

export function SegmentCounter({ text }: { text: string }) {
  const chars = Array.from(text).length;
  const gsm = /^[\x20-\x7E\n\r€£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉÄÖÑÜ§¿äöñüà]*$/u.test(text);
  const per = gsm ? (chars <= 160 ? 160 : 153) : chars <= 70 ? 70 : 67;
  const segments = chars === 0 ? 0 : Math.ceil(chars / per);
  return (
    <span className={`text-apple-xs ${segments > 3 ? "text-apple-orange" : "text-apple-text-tertiary"}`}>
      {chars} chars · {segments} segment{segments === 1 ? "" : "s"} ({gsm ? "153/segment" : "unicode, 67/segment"})
    </span>
  );
}

export function fmtDate(d: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString(undefined, opts ?? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className="mb-1.5 text-apple-xs font-medium text-apple-text-secondary">{label}</div>
      {children}
      {hint && <p className="mt-1 text-apple-xs text-apple-text-tertiary">{hint}</p>}
    </div>
  );
}

/** Minimal member search box (uses /api/admin/marketing/member-search). */
export function MemberSearch({ onPick, placeholder = "Search members by name, email or phone…" }: { onPick: (m: { id: string; firstName: string; lastName: string; email: string; phone: string }) => void; placeholder?: string }) {
  const { slug } = useAdminLocation();
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<{ id: string; firstName: string; lastName: string; email: string; phone: string }[]>([]);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/marketing/member-search?q=${encodeURIComponent(q)}&slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
        if (res.ok) {
          const j = await res.json();
          setResults(j.items ?? []);
          setOpen(true);
        }
      } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [q, slug]);
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => results.length && setOpen(true)} placeholder={placeholder} className="w-full rounded-apple-sm border border-apple-border px-3 py-2 text-apple-sm outline-none focus:border-apple-blue" />
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-apple-sm border border-apple-border bg-white shadow-apple-md">
          {results.slice(0, 10).map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => { onPick(m); setOpen(false); setQ(`${m.firstName} ${m.lastName}`); }} className="flex w-full flex-col px-3 py-2 text-left hover:bg-apple-fill-secondary">
                <span className="text-apple-sm text-apple-text">{m.firstName} {m.lastName}</span>
                <span className="text-apple-xs text-apple-text-tertiary">{m.email} · {m.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
