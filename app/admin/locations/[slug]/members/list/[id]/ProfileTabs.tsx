"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminRoutes, MEMBER_PROFILE_TABS } from "@/lib/admin/routes";

const LABELS: Record<(typeof MEMBER_PROFILE_TABS)[number], string> = {
  memberships: "Memberships",
  payments: "Payments",
  documents: "Documents",
  attendance: "Attendance",
  messaging: "Messaging",
  family: "Family",
  notes: "Notes",
};

/** Same look as components/ui Tabs, but the Overview tab only matches exactly. */
export function ProfileTabs({ slug, memberId }: { slug: string; memberId: string }) {
  const pathname = usePathname();
  const items = [
    { label: "Overview", href: adminRoutes.loc.members.detail(slug, memberId), exact: true },
    ...MEMBER_PROFILE_TABS.map((tab) => ({ label: LABELS[tab], href: adminRoutes.loc.members.detailTab(slug, memberId, tab), exact: false })),
  ];
  return (
    <nav className="-mx-1 flex items-center gap-1 overflow-x-auto border-b border-apple-divider px-1" aria-label="Member profile tabs">
      {items.map((it) => {
        const active = it.exact ? pathname === it.href : pathname === it.href || pathname?.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            className={[
              "relative inline-flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-apple-sm font-medium transition-colors",
              "rounded-t-apple-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/30",
              active
                ? "text-apple-text after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-apple-blue after:content-['']"
                : "text-apple-text-secondary hover:text-apple-text",
            ].join(" ")}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
