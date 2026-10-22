"use client";

import React from "react";
import type { Prisma } from "@prisma/client";

type J = Prisma.JsonValue | null | undefined;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Compact, expandable rendering of before/after diff + metadata. */
export function AuditDetail({ before, after, metadata }: { before: J; after: J; metadata: J }) {
  const [open, setOpen] = React.useState(false);

  const changedKeys = React.useMemo(() => {
    const keys = new Set<string>();
    if (isObj(before)) Object.keys(before).forEach((k) => keys.add(k));
    if (isObj(after)) Object.keys(after).forEach((k) => keys.add(k));
    return [...keys].filter((k) => JSON.stringify(isObj(before) ? before[k] : undefined) !== JSON.stringify(isObj(after) ? after[k] : undefined));
  }, [before, after]);

  const metaEntries = isObj(metadata) ? Object.entries(metadata) : [];
  const nothing = changedKeys.length === 0 && metaEntries.length === 0 && !before && !after;
  if (nothing) return <span className="text-apple-text-tertiary">—</span>;

  const summary = changedKeys.length > 0 ? `${changedKeys.length} field${changedKeys.length === 1 ? "" : "s"} changed: ${changedKeys.slice(0, 4).join(", ")}${changedKeys.length > 4 ? "…" : ""}` : metaEntries.slice(0, 3).map(([k, v]) => `${k}=${fmt(v)}`).join(" · ");

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-left text-apple-xs text-apple-text-secondary hover:text-apple-blue">
        {summary || "View"} <span className="text-apple-text-tertiary">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {changedKeys.length > 0 && (
            <table className="w-full text-apple-xs">
              <tbody>
                {changedKeys.map((k) => (
                  <tr key={k} className="border-t border-apple-divider first:border-t-0">
                    <td className="py-1 pr-2 font-mono text-apple-text-tertiary">{k}</td>
                    <td className="py-1 pr-2 text-apple-red/80 line-through">{fmt(isObj(before) ? before[k] : undefined)}</td>
                    <td className="py-1 text-apple-green">{fmt(isObj(after) ? after[k] : undefined)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {metaEntries.length > 0 && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-apple-fill-secondary p-2">{JSON.stringify(metadata, null, 1)}</pre>
          )}
          {changedKeys.length === 0 && (before || after) && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-apple-fill-secondary p-2">{JSON.stringify({ before, after }, null, 1)}</pre>
          )}
        </div>
      )}
    </div>
  );
}
