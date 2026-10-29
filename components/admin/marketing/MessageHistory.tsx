"use client";

import React from "react";
import Link from "next/link";
import { Badge, Card, StatusBadge } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { useAdminLocation } from "@/components/admin/LocationContext";
import { fmtDate } from "./shared";

export type HistoryRow = {
  id: string;
  channel: string;
  category: string;
  status: string;
  subject: string | null;
  body: string;
  createdAt: string;
  scheduledFor: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  member: { id: string; firstName: string; lastName: string } | null;
};

const TABS = [
  { key: "ALL", label: "All" },
  { key: "PUSH", label: "Push" },
  { key: "SMS", label: "SMS" },
  { key: "EMAIL", label: "Email" },
  { key: "SCHEDULED", label: "Scheduled" },
] as const;

export function MessageHistory({ rows }: { rows: HistoryRow[] }) {
  const { slug } = useAdminLocation();
  const [tab, setTab] = React.useState<(typeof TABS)[number]["key"]>("ALL");
  const [category, setCategory] = React.useState<string>("");

  const filtered = rows.filter((r) => {
    if (tab === "SCHEDULED") return r.status === "QUEUED" && !!r.scheduledFor;
    if (tab !== "ALL" && r.channel !== tab) return false;
    if (category && r.category !== category) return false;
    return true;
  });
  const counts = { ALL: rows.length, PUSH: rows.filter((r) => r.channel === "PUSH").length, EMAIL: rows.filter((r) => r.channel === "EMAIL").length, SMS: rows.filter((r) => r.channel === "SMS").length, SCHEDULED: rows.filter((r) => r.status === "QUEUED" && r.scheduledFor).length };

  return (
    <Card padded={false}>
      <div className="flex flex-col gap-2 border-b border-apple-divider px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`rounded-apple-sm px-3 py-1.5 text-apple-sm font-medium ${tab === t.key ? "bg-apple-fill-secondary text-apple-text" : "text-apple-text-secondary hover:text-apple-text"}`}>
              {t.label} <span className="text-apple-xs text-apple-text-tertiary">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {["", "MARKETING", "TRANSACTIONAL", "SYSTEM"].map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={`rounded-full border px-2.5 py-0.5 text-apple-xs ${category === c ? "border-apple-blue bg-apple-blue text-white" : "border-apple-border text-apple-text-secondary"}`}>
              {c || "Any category"}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="p-6 text-center text-apple-sm text-apple-text-tertiary">No messages.</p>
      ) : (
        <ul className="divide-y divide-apple-divider">
          {filtered.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 p-4 text-apple-sm">
              <div className="min-w-0">
                <div className="truncate font-medium text-apple-text">{m.subject ?? m.body.replace(/<[^>]+>/g, " ").slice(0, 90)}</div>
                <div className="truncate text-apple-xs text-apple-text-tertiary">
                  {m.channel} · {m.category.toLowerCase()} ·{" "}
                  {m.member ? (
                    <Link href={adminRoutes.loc.members.detail(slug, m.member.id)} className="hover:text-apple-blue">{m.member.firstName} {m.member.lastName}</Link>
                  ) : (
                    "lead"
                  )}{" "}
                  · {m.status === "QUEUED" && m.scheduledFor ? `scheduled ${fmtDate(m.scheduledFor)}` : fmtDate(m.createdAt)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {m.openedAt && <Badge tone="info" size="sm">opened</Badge>}
                {m.clickedAt && <Badge tone="success" size="sm">clicked</Badge>}
                <StatusBadge status={m.status} size="sm" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
