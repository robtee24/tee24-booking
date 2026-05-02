"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type TabItem = {
  href: string;
  label: string;
  badge?: number | string;
};

export function Tabs({ items }: { items: TabItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-apple-divider" aria-label="Tabs">
      {items.map((it) => {
        const active = pathname === it.href || (it.href !== "/" && pathname?.startsWith(it.href));
        return (
          <Link
            key={it.href}
            href={it.href}
            className={[
              "relative inline-flex items-center gap-1.5 px-3 py-2.5 text-apple-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/30 rounded-t-apple-sm",
              active
                ? "text-apple-text after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-apple-blue after:content-['']"
                : "text-apple-text-secondary hover:text-apple-text",
            ].join(" ")}
          >
            {it.label}
            {it.badge != null && (
              <span className="rounded-full bg-apple-fill-secondary px-1.5 py-0.5 text-[10px] font-medium text-apple-text-secondary">
                {it.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
