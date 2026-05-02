"use client";

import { Tabs } from "@/components/ui";

export function ProfileTabs({ slug, memberId }: { slug: string; memberId: string }) {
  const base = `/admin/locations/${slug}/members/list/${memberId}`;
  return (
    <Tabs
      items={[
        { label: "Overview", href: base },
        { label: "Memberships", href: `${base}/memberships` },
        { label: "Payments", href: `${base}/payments` },
        { label: "Documents", href: `${base}/documents` },
        { label: "Attendance", href: `${base}/attendance` },
        { label: "Messaging", href: `${base}/messaging` },
        { label: "Family", href: `${base}/family` },
        { label: "Notes", href: `${base}/notes` },
      ]}
    />
  );
}
