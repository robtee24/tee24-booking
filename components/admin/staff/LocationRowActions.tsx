"use client";

import React from "react";
import Link from "next/link";
import { MoreHorizontal, LayoutDashboard, Settings, Users, CreditCard } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";

/** Kebab menu for a location row: Open dashboard / Settings / Members / Billing. */
export function LocationRowActions({ slug, name }: { slug: string; name: string }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = [
    { label: "Open dashboard", href: adminRoutes.loc.dashboard(slug), icon: LayoutDashboard },
    { label: "Settings", href: adminRoutes.loc.root(slug), icon: Settings },
    { label: "Members", href: adminRoutes.loc.members.list(slug), icon: Users },
    { label: "Billing", href: adminRoutes.loc.billing.root(slug), icon: CreditCard },
  ];

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-apple-sm p-1.5 text-apple-text-tertiary hover:bg-apple-fill-secondary hover:text-apple-text"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${name}`}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-apple border border-apple-border bg-white py-1 shadow-apple-md">
          {items.map((it) => (
            <Link
              key={it.href}
              role="menuitem"
              href={it.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-apple-sm text-apple-text hover:bg-apple-fill-secondary"
            >
              <it.icon className="h-4 w-4 text-apple-text-tertiary" />
              {it.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
