"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, IdCard, Settings, UserRound, Home } from "lucide-react";

/**
 * Secondary "My account" strip shown on the account pages (profile, membership,
 * card, settings). The primary clubhouse nav lives in PortalNav.
 */
const ITEMS = [
  { href: "/portal", label: "Clubhouse", icon: Home, exact: true },
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
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-apple-pill px-3 py-1.5 text-apple-sm font-medium transition-colors ${active ? "bg-[#0b3d2e] text-white" : "bg-white text-apple-text-secondary ring-1 ring-apple-border hover:text-[#0b3d2e] hover:ring-[#22c55e]"}`}
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
