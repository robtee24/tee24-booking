"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Search, Plus, Users, Download, Tag as TagIcon, Snowflake, XCircle, Mail, Eye } from "lucide-react";
import { Button, Card, DataTable, EmptyState, Input, PageHeader, StatusBadge, type Column } from "@/components/ui";

type MemberRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  membershipType: string | null;
  joinDate: string | null;
  kisiAccessEnabled: boolean;
  memberTags: Array<{ tag: { id: string; name: string; color: string | null } }>;
};

const STATUS_TABS = [
  { key: "ALL", label: "All" },
  { key: "ACTIVE", label: "Members" },
  { key: "VISITOR", label: "Visitors" },
  { key: "FROZEN", label: "Frozen" },
  { key: "CANCELLED", label: "Cancelled" },
] as const;

export default function MembersListPage() {
  const params = useParams() as { slug?: string };
  const router = useRouter();
  const slug = params?.slug ?? "";

  const [activeStatus, setActiveStatus] = useState<typeof STATUS_TABS[number]["key"]>("ACTIVE");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancel = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ locationSlug: slug });
        if (activeStatus !== "ALL") params.set("status", activeStatus);
        if (debouncedSearch) params.set("search", debouncedSearch);
        const res = await fetch(`/api/admin/members?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        if (cancel) return;
        setRows(json.items ?? []);
        setCounts(json.counts ?? {});
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    if (slug) load();
    return () => { cancel = true; };
  }, [slug, activeStatus, debouncedSearch]);

  const cols = useMemo<Column<MemberRow>[]>(() => [
    {
      key: "name",
      header: "Member",
      cell: (r) => (
        <div>
          <div className="font-medium text-apple-text">{r.firstName} {r.lastName}</div>
          <div className="text-apple-xs text-apple-text-tertiary">{r.email}</div>
        </div>
      ),
    },
    {
      key: "phone",
      header: "Phone",
      cell: (r) => <span className="text-apple-sm text-apple-text-secondary">{r.phone}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "membership",
      header: "Membership",
      cell: (r) => <span className="text-apple-sm text-apple-text-secondary">{r.membershipType || "—"}</span>,
    },
    {
      key: "tags",
      header: "Tags",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.memberTags.slice(0, 3).map((t) => (
            <span key={t.tag.id} className="rounded-full px-2 py-0.5 text-[10px]" style={{ backgroundColor: (t.tag.color ?? "#16a34a") + "20", color: t.tag.color ?? "#16a34a" }}>
              {t.tag.name}
            </span>
          ))}
          {r.memberTags.length > 3 && <span className="text-apple-xs text-apple-text-tertiary">+{r.memberTags.length - 3}</span>}
        </div>
      ),
    },
    {
      key: "kisi",
      header: "Door",
      cell: (r) => (
        <span className={r.kisiAccessEnabled ? "text-apple-green" : "text-apple-red"}>
          {r.kisiAccessEnabled ? "Enabled" : "Disabled"}
        </span>
      ),
    },
    {
      key: "joined",
      header: "Joined",
      cell: (r) => (
        <span className="text-apple-sm text-apple-text-secondary">
          {r.joinDate ? new Date(r.joinDate).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <button
          onClick={async (e) => {
            e.stopPropagation();
            const ok = window.confirm(`Open the member portal as ${r.firstName} ${r.lastName}? Your activity will be audit-logged.`);
            if (!ok) return;
            const res = await fetch("/api/portal/impersonation/start", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ memberId: r.id }),
            });
            if (res.ok) {
              const json = await res.json();
              window.open(json.redirectUrl ?? "/portal", "_blank");
            } else {
              alert(`Failed: ${await res.text()}`);
            }
          }}
          className="rounded-full border border-apple-red/30 bg-apple-red/5 p-1.5 text-apple-red hover:bg-apple-red/10"
          title="View as member"
        >
          <Eye className="h-4 w-4" />
        </button>
      ),
    },
  ], []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description="Members, visitors, frozen, and cancelled accounts"
        actions={
          <>
            <Button variant="secondary" iconLeft={<Download className="h-4 w-4" />}>
              Export
            </Button>
            <Link href={`/admin/locations/${slug}/members/list/new`}>
              <Button iconLeft={<Plus className="h-4 w-4" />}>Add member</Button>
            </Link>
          </>
        }
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-apple-divider px-4 py-3">
          <div className="flex flex-wrap items-center gap-1">
            {STATUS_TABS.map((t) => {
              const isActive = activeStatus === t.key;
              const count = counts[t.key] ?? 0;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveStatus(t.key)}
                  className={[
                    "rounded-full px-3 py-1 text-apple-xs font-medium transition-colors",
                    isActive ? "bg-apple-blue text-white" : "text-apple-text-secondary hover:bg-apple-fill-secondary",
                  ].join(" ")}
                >
                  {t.label}
                  {counts[t.key] != null && (
                    <span className={["ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]",
                      isActive ? "bg-white/20 text-white" : "bg-apple-fill-secondary text-apple-text-tertiary"].join(" ")}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="w-full max-w-xs">
            <Input
              prefix={<Search className="h-4 w-4" />}
              placeholder="Search name, email, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-apple-divider bg-apple-blue/5 px-4 py-2">
            <span className="text-apple-sm text-apple-text">{selected.size} selected</span>
            <Button size="sm" variant="ghost" iconLeft={<TagIcon className="h-4 w-4" />}>Tag</Button>
            <Button size="sm" variant="ghost" iconLeft={<Mail className="h-4 w-4" />}>Message</Button>
            <Button size="sm" variant="ghost" iconLeft={<Snowflake className="h-4 w-4" />}>Freeze</Button>
            <Button size="sm" variant="danger" iconLeft={<XCircle className="h-4 w-4" />}>Cancel</Button>
          </div>
        )}

        <DataTable<MemberRow>
          columns={cols}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          selectable
          selectedKeys={selected}
          onSelectionChange={setSelected}
          onRowClick={(r) => router.push(`/admin/locations/${slug}/members/list/${r.id}`)}
          empty={
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title="No members yet"
              description="Add your first member or wait for a signup form to capture one."
              action={
                <Link href={`/admin/locations/${slug}/members/list/new`}>
                  <Button iconLeft={<Plus className="h-4 w-4" />}>Add member</Button>
                </Link>
              }
            />
          }
        />
      </Card>
    </div>
  );
}
