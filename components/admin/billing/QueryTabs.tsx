"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type QueryTabItem = { value: string; label: string; badge?: number | string };

/**
 * Tabs driven by a `?tab=` query param (the shared `Tabs` primitive matches on
 * pathname, which doesn't work for same-page tabs). Preserves other params.
 */
export function QueryTabs({ items, param = "tab", defaultValue }: { items: QueryTabItem[]; param?: string; defaultValue: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = sp.get(param) ?? defaultValue;
  return (
    <nav className="-mx-1 flex items-center gap-1 overflow-x-auto border-b border-apple-divider px-1" aria-label="Tabs">
      {items.map((it) => {
        const active = current === it.value;
        const next = new URLSearchParams(sp.toString());
        next.set(param, it.value);
        return (
          <Link
            key={it.value}
            href={`${pathname}?${next.toString()}`}
            className={[
              "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-apple-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/30 rounded-t-apple-sm",
              active
                ? "text-apple-text after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-apple-blue after:content-['']"
                : "text-apple-text-secondary hover:text-apple-text",
            ].join(" ")}
          >
            {it.label}
            {it.badge != null && (
              <span className="rounded-full bg-apple-fill-secondary px-1.5 py-0.5 text-[10px] font-medium text-apple-text-secondary">{it.badge}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
