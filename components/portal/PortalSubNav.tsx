"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, IdCard, Settings, UserRound, Home } from "lucide-react";

/**
 * Secondary nav for the account pages this module owns. The primary tab bar
 * lives in app/portal/layout.tsx (owned elsewhere); until Settings / Card /
 * Membership / Profile are added there, this strip keeps them reachable.
 */
const ITEMS = [
  { href: "/portal", label: "Home", icon: Home, exact: true },
  { href: "/portal/profile", label: "Profile", icon: UserRound },
  { href: "/portal/membership", label: "Membership", icon: CreditCard },
  { href: "/portal/card", label: "Member card", icon: IdCard },
  { href: "/portal/settings", label: "Settings", icon: Settings },
];

export function PortalSubNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Account" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
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
