"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, CalendarDays, Target, Footprints, Trophy, IdCard, Receipt, FileText, MessageCircle, Settings } from "lucide-react";

/**
 * Primary clubhouse navigation. Rendered inside the dark-green header band in
 * app/portal/(app)/layout.tsx; active state is derived from the pathname.
 */
const ITEMS = [
  { href: "/portal", label: "Clubhouse", icon: Home, exact: true },
  { href: "/portal/schedule", label: "Book a bay", icon: CalendarDays },
  { href: "/portal/swing", label: "Swing Lab", icon: Target },
  { href: "/portal/attendance", label: "My rounds", icon: Footprints },
  { href: "/portal/membership", label: "Membership", icon: Trophy },
  { href: "/portal/card", label: "Member card", icon: IdCard },
  { href: "/portal/billing", label: "Billing", icon: Receipt },
  { href: "/portal/documents", label: "Documents", icon: FileText },
  { href: "/portal/contact", label: "Contact", icon: MessageCircle },
  { href: "/portal/settings", label: "Settings", icon: Settings },
];

export function PortalNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Clubhouse" className="mx-auto flex max-w-5xl items-center gap-1.5 overflow-x-auto px-4 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {ITEMS.map((it) => {
        const active = it.exact ? pathname === it.href : pathname?.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={[
              "inline-flex shrink-0 items-center gap-1.5 rounded-apple-pill px-3 py-1.5 text-apple-sm font-medium transition-colors",
              active ? "bg-white text-[#0b3d2e] shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white",
            ].join(" ")}
          >
            <it.icon className="h-4 w-4" />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
