"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Filter, Mail, Search, Snowflake, Tag as TagIcon, Users, X, XCircle } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { Badge, Button, Card, DataTable, Drawer, EmptyState, Input, Modal, Money, Select, StatusBadge, useToast, type Column } from "@/components/ui";
import { Avatar, Checkbox, MONTHS, TagChip, ageFromDob, api, errMsg, fmtDate, relTime } from "@/components/admin/members/shared";

type Row = {
  id: string; firstName: string; lastName: string; email: string; phone: string; status: string; photoUrl: string | null; joinDate: string | null; dob: string | null; gender: string | null;
  checkinCode: string | null; membershipType: string | null; kisiAccessEnabled: boolean;
  memberTags: Array<{ tag: { id: string; name: string; color: string | null } }>;
  subscription: { id: string; status: string; planName: string; paidThroughDate: string | null; nextInvoiceDate: string | null } | null;
  lastVisitAt: string | null;
  billing: { nextInvoiceDue: string | null; nextInvoiceCents: number | null; overdueCents: number; overdueCount: number; hasCard: boolean };
};
type ListResponse = { items: Row[]; total: number; page: number; pageSize: number; counts: Record<string, number> };
type Tag = { id: string; name: string; color: string | null; memberCount?: number };
type Plan = { id: string; name: string };

const STATUS_TABS = [
  { key: "ALL", label: "All" },
  { key: "ACTIVE", label: "Members" },
  { key: "PENDING", label: "Pending" },
  { key: "VISITOR", label: "Visitors" },
  { key: "FROZEN", label: "Frozen" },
  { key: "CANCELLED", label: "Cancelled" },
] as const;

type Filters = {
  tagIds: string[]; planId: string; joinedFrom: string; joinedTo: string; membershipStartFrom: string; membershipStartTo: string; membershipEndFrom: string; membershipEndTo: string;
  birthMonth: string; gender: string; minAge: string; maxAge: string; lastVisitBefore: string; lastVisitAfter: string; hasCard: string; missingRequiredDoc: string; emailOptIn: string; smsOptIn: string;
};
const EMPTY_FILTERS: Filters = { tagIds: [], planId: "", joinedFrom: "", joinedTo: "", membershipStartFrom: "", membershipStartTo: "", membershipEndFrom: "", membershipEndTo: "", birthMonth: "", gender: "", minAge: "", maxAge: "", lastVisitBefore: "", lastVisitAfter: "", hasCard: "", missingRequiredDoc: "", emailOptIn: "", smsOptIn: "" };

function filtersFromParams(sp: URLSearchParams): Filters {
  const f = { ...EMPTY_FILTERS };
  for (const k of Object.keys(EMPTY_FILTERS) as (keyof Filters)[]) {
    if (k === "tagIds") f.tagIds = sp.getAll("tagIds").flatMap((v) => v.split(",")).filter(Boolean);
    else f[k] = sp.get(k) ?? "";
  }
  return f;
}
function countActive(f: Filters): number {
  return (Object.keys(f) as (keyof Filters)[]).reduce((n, k) => n + (k === "tagIds" ? (f.tagIds.length ? 1 : 0) : f[k] ? 1 : 0), 0);
}

export default function MembersListClient({ slug, plans }: { slug: string; plans: Plan[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const { toast } = useToast();

  // URL is the source of truth for status/search/filters/sort/page so links are shareable.
  const status = (sp.get("status") || "ACTIVE").toUpperCase();
  const search = sp.get("search") || "";
  const sortBy = sp.get("sortBy") || "name";
  const sortDir = (sp.get("sortDir") as "asc" | "desc") || "asc";
  const page = Math.max(1, Number(sp.get("page") || 1));
  const pageSize = [25, 50, 100].includes(Number(sp.get("pageSize"))) ? Number(sp.get("pageSize")) : 25;
  const filters = React.useMemo(() => filtersFromParams(new URLSearchParams(sp.toString())), [sp]);
  const activeFilterCount = countActive(filters);

  const [searchDraft, setSearchDraft] = React.useState(search);
  const [data, setData] = React.useState<ListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [tags, setTags] = React.useState<Tag[]>([]);
  const [bulk, setBulk] = React.useState<null | "addTag" | "removeTag" | "freeze" | "cancel">(null);
  const [bulkBusy, setBulkBusy] = React.useState(false);

  const setParams = React.useCallback(
    (patch: Record<string, string | string[] | null | undefined>, { resetPage = true } = {}) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        next.delete(k);
        if (Array.isArray(v)) v.forEach((x) => x && next.append(k, x));
        else if (v) next.set(k, v);
      }
      if (resetPage) next.delete("page");
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [router, sp],
  );

  React.useEffect(() => setSearchDraft(search), [search]);
  React.useEffect(() => {
    if (searchDraft === search) return;
    const t = setTimeout(() => setParams({ search: searchDraft.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  React.useEffect(() => {
    api<{ tags: Tag[] }>(`/api/admin/tags?locationSlug=${encodeURIComponent(slug)}`).then((r) => setTags(r.tags ?? [])).catch(() => {});
  }, [slug]);

  const queryString = React.useMemo(() => {
    const q = new URLSearchParams(sp.toString());
    q.set("locationSlug", slug);
    if (!q.get("status")) q.set("status", "ACTIVE");
    if (!q.get("pageSize")) q.set("pageSize", String(pageSize));
    if (!q.get("sortBy")) q.set("sortBy", sortBy);
    if (!q.get("sortDir")) q.set("sortDir", sortDir);
    return q.toString();
  }, [sp, slug, pageSize, sortBy, sortDir]);

  const load = React.useCallback(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    api<ListResponse>(`/api/admin/members?${queryString}`)
      .then((r) => { if (!cancel) { setData(r); setSelected(new Set()); } })
      .catch((e) => { if (!cancel) setError(errMsg(e)); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [queryString]);
  React.useEffect(load, [load]);

  const counts = data?.counts ?? {};
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  async function runBulk(action: string, extra: Record<string, unknown>) {
    setBulkBusy(true);
    try {
      const r = await api<{ affected: number; errors?: string[] }>(`/api/admin/members/bulk`, { method: "POST", json: { locationSlug: slug, memberIds: Array.from(selected), action, ...extra } });
      toast({ tone: "success", title: `${r.affected} member${r.affected === 1 ? "" : "s"} updated`, description: r.errors?.length ? `${r.errors.length} skipped` : undefined });
      setBulk(null);
      load();
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Bulk action failed", description: errMsg(e) });
    } finally {
      setBulkBusy(false);
    }
  }

  const exportHref = `/api/admin/members/export?${queryString}`;

  const columns: Column<Row>[] = [
    {
      key: "name", header: "Member", sortable: true,
      cell: (m) => (
        <div className="flex items-center gap-3">
          <Avatar photoUrl={m.photoUrl} first={m.firstName} last={m.lastName} size="sm" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Link href={adminRoutes.loc.members.detail(slug, m.id)} className="font-medium text-apple-text hover:underline" onClick={(e) => e.stopPropagation()}>{m.firstName} {m.lastName}</Link>
              {status === "ALL" && <StatusBadge status={m.status} size="sm" />}
            </div>
            <div className="truncate text-apple-xs text-apple-text-tertiary">{m.email}{m.phone ? ` · ${m.phone}` : ""}</div>
            {m.memberTags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {m.memberTags.slice(0, 3).map((t) => <TagChip key={t.tag.id} name={t.tag.name} color={t.tag.color} />)}
                {m.memberTags.length > 3 && <span className="text-apple-xs text-apple-text-tertiary">+{m.memberTags.length - 3}</span>}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "membership", header: "Membership",
      cell: (m) => m.subscription ? (
        <div>
          <div className="text-apple-text">{m.subscription.planName}</div>
          <div className="flex items-center gap-1.5 text-apple-xs text-apple-text-tertiary">
            <StatusBadge status={m.subscription.status} size="sm" />
            {m.subscription.paidThroughDate && <span>thru {fmtDate(m.subscription.paidThroughDate)}</span>}
          </div>
        </div>
      ) : <span className="text-apple-text-tertiary">{m.membershipType ?? "—"}</span>,
    },
    {
      key: "billing", header: "Billing",
      cell: (m) => m.billing.overdueCount > 0 ? (
        <span className="text-apple-red"><Money cents={m.billing.overdueCents} /> overdue</span>
      ) : m.billing.nextInvoiceDue ? (
        <span className="text-apple-text-secondary"><Money cents={m.billing.nextInvoiceCents} /> on {fmtDate(m.billing.nextInvoiceDue)}</span>
      ) : (
        <span className="text-apple-text-tertiary">{m.billing.hasCard ? "Card on file" : "No card"}</span>
      ),
    },
    { key: "lastVisit", header: "Last visit", sortable: true, cell: (m) => <span className={m.lastVisitAt ? "text-apple-text-secondary" : "text-apple-text-tertiary"}>{relTime(m.lastVisitAt)}</span> },
    { key: "joinDate", header: "Joined", sortable: true, cell: (m) => <span className="text-apple-text-secondary">{fmtDate(m.joinDate)}</span> },
    { key: "age", header: "Age", sortable: true, align: "right", cell: (m) => { const a = ageFromDob(m.dob); return <span className="text-apple-text-secondary">{a ?? "—"}</span>; } },
    { key: "access", header: "Door", align: "center", cell: (m) => <span className={`inline-block h-2.5 w-2.5 rounded-full ${m.kisiAccessEnabled ? "bg-apple-green" : "bg-apple-text-tertiary/40"}`} title={m.kisiAccessEnabled ? "Door access on" : "Door access off"} /> },
  ];

  const selectedIds = Array.from(selected);
  const composeHref = `${adminRoutes.loc.marketing.compose(slug)}?memberIds=${selectedIds.join(",")}`;

  return (
    <div className="space-y-4">
      {/* Status tabs */}
      <div className="-mx-1 flex items-center gap-1 overflow-x-auto border-b border-apple-divider px-1">
        {STATUS_TABS.map((t) => {
          const active = status === t.key;
          const n = counts[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setParams({ status: t.key === "ACTIVE" ? null : t.key })}
              className={`relative shrink-0 px-3 py-2.5 text-apple-sm font-medium transition-colors ${active ? "text-apple-text after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-apple-blue after:content-['']" : "text-apple-text-secondary hover:text-apple-text"}`}
            >
              {t.label}
              {n != null && <span className={`ml-1.5 rounded-full px-1.5 text-apple-xs ${active ? "bg-apple-blue/10 text-apple-blue" : "bg-apple-fill-secondary text-apple-text-tertiary"}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex-1">
          <Input prefix={<Search className="h-4 w-4" />} placeholder="Search name, email, phone or check-in code…" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} suffix={searchDraft ? <button type="button" onClick={() => setSearchDraft("")} aria-label="Clear"><X className="h-4 w-4" /></button> : undefined} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" iconLeft={<Filter className="h-4 w-4" />} onClick={() => setFiltersOpen(true)}>
            Filters{activeFilterCount > 0 && <span className="ml-1.5 rounded-full bg-apple-blue px-1.5 text-apple-xs text-white">{activeFilterCount}</span>}
          </Button>
          <a href={exportHref} className="inline-flex h-10 items-center gap-2 rounded-apple-sm border border-apple-border bg-white px-4 text-apple-sm font-medium text-apple-text hover:bg-apple-fill-secondary">
            <Download className="h-4 w-4" /> Export CSV
          </a>
          <Select value={String(pageSize)} onChange={(e) => setParams({ pageSize: e.target.value })} aria-label="Rows per page">
            <option value="25">25 / page</option>
            <option value="50">50 / page</option>
            <option value="100">100 / page</option>
          </Select>
        </div>
      </div>

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-apple-xs">
          {filters.tagIds.length > 0 && <Chip label={`Tags: ${filters.tagIds.map((id) => tags.find((t) => t.id === id)?.name ?? "…").join(", ")}`} onClear={() => setParams({ tagIds: null })} />}
          {filters.planId && <Chip label={`Plan: ${plans.find((p) => p.id === filters.planId)?.name ?? "…"}`} onClear={() => setParams({ planId: null })} />}
          {(filters.joinedFrom || filters.joinedTo) && <Chip label={`Joined ${filters.joinedFrom || "…"} → ${filters.joinedTo || "…"}`} onClear={() => setParams({ joinedFrom: null, joinedTo: null })} />}
          {(filters.membershipStartFrom || filters.membershipStartTo) && <Chip label={`Membership start ${filters.membershipStartFrom || "…"} → ${filters.membershipStartTo || "…"}`} onClear={() => setParams({ membershipStartFrom: null, membershipStartTo: null })} />}
          {(filters.membershipEndFrom || filters.membershipEndTo) && <Chip label={`Membership end ${filters.membershipEndFrom || "…"} → ${filters.membershipEndTo || "…"}`} onClear={() => setParams({ membershipEndFrom: null, membershipEndTo: null })} />}
          {filters.birthMonth && <Chip label={`Birthday in ${MONTHS[Number(filters.birthMonth) - 1]}`} onClear={() => setParams({ birthMonth: null })} />}
          {filters.gender && <Chip label={`Gender: ${filters.gender}`} onClear={() => setParams({ gender: null })} />}
          {(filters.minAge || filters.maxAge) && <Chip label={`Age ${filters.minAge || "0"}–${filters.maxAge || "∞"}`} onClear={() => setParams({ minAge: null, maxAge: null })} />}
          {(filters.lastVisitAfter || filters.lastVisitBefore) && <Chip label={`Last visit ${filters.lastVisitAfter || "…"} → ${filters.lastVisitBefore || "…"}`} onClear={() => setParams({ lastVisitAfter: null, lastVisitBefore: null })} />}
          {filters.hasCard && <Chip label={filters.hasCard === "1" ? "Has card" : "No card"} onClear={() => setParams({ hasCard: null })} />}
          {filters.missingRequiredDoc && <Chip label={filters.missingRequiredDoc === "1" ? "Missing required doc" : "All docs signed"} onClear={() => setParams({ missingRequiredDoc: null })} />}
          {filters.emailOptIn && <Chip label={filters.emailOptIn === "1" ? "Email opt-in" : "Email opt-out"} onClear={() => setParams({ emailOptIn: null })} />}
          {filters.smsOptIn && <Chip label={filters.smsOptIn === "1" ? "SMS opt-in" : "SMS opt-out"} onClear={() => setParams({ smsOptIn: null })} />}
          <button type="button" className="text-apple-blue hover:underline" onClick={() => setParams(Object.fromEntries(Object.keys(EMPTY_FILTERS).map((k) => [k, null])))}>Clear all</button>
        </div>
      )}

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-col gap-2 rounded-apple border border-apple-blue/30 bg-apple-blue/5 p-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-apple-sm font-medium text-apple-text">{selected.size} selected</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" iconLeft={<TagIcon className="h-3.5 w-3.5" />} onClick={() => setBulk("addTag")}>Add tag</Button>
            <Button size="sm" variant="secondary" iconLeft={<TagIcon className="h-3.5 w-3.5" />} onClick={() => setBulk("removeTag")}>Remove tag</Button>
            <Link href={composeHref} className="inline-flex h-8 items-center gap-1.5 rounded-apple-sm border border-apple-border bg-white px-3 text-apple-xs font-medium text-apple-text hover:bg-apple-fill-secondary"><Mail className="h-3.5 w-3.5" /> Message</Link>
            <Button size="sm" variant="secondary" iconLeft={<Snowflake className="h-3.5 w-3.5" />} onClick={() => setBulk("freeze")}>Freeze</Button>
            <Button size="sm" variant="danger" iconLeft={<XCircle className="h-3.5 w-3.5" />} onClick={() => setBulk("cancel")}>Cancel</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      {error ? (
        <div className="rounded-apple border border-apple-red/30 bg-apple-red/5 p-3 text-apple-sm text-apple-red">{error}</div>
      ) : !loading && total === 0 ? (
        <EmptyState icon={<Users className="h-5 w-5" />} title={search || activeFilterCount ? "No members match" : "No members yet"} description={search || activeFilterCount ? "Try a different search or clear filters." : "Add your first member to get started."} action={!search && !activeFilterCount ? <Link href={adminRoutes.loc.members.new(slug)}><Button>Add member</Button></Link> : undefined} />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(m) => m.id}
            loading={loading}
            selectable
            selectedKeys={selected}
            onSelectionChange={setSelected}
            sortKey={sortBy}
            sortDirection={sortDir}
            onSortChange={(key, dir) => setParams({ sortBy: key, sortDir: dir })}
            onRowClick={(m) => router.push(adminRoutes.loc.members.detail(slug, m.id))}
          />
          <div className="flex flex-col gap-2 border-t border-apple-divider px-4 py-3 text-apple-xs text-apple-text-secondary sm:flex-row sm:items-center sm:justify-between">
            <span>{total === 0 ? "" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) }, { resetPage: false })}>Previous</Button>
              <span>Page {page} / {pages}</span>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setParams({ page: String(page + 1) }, { resetPage: false })}>Next</Button>
            </div>
          </div>
        </Card>
      )}

      <FiltersDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} initial={filters} tags={tags} plans={plans} onApply={(f) => { setParams(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Array.isArray(v) ? v : v || null]))); setFiltersOpen(false); }} />

      {(bulk === "addTag" || bulk === "removeTag") && (
        <BulkTagModal mode={bulk} tags={tags} count={selected.size} busy={bulkBusy} onClose={() => setBulk(null)} onSubmit={(payload) => void runBulk(bulk, payload)} />
      )}
      {bulk === "freeze" && <BulkFreezeModal count={selected.size} busy={bulkBusy} onClose={() => setBulk(null)} onSubmit={(payload) => void runBulk("freeze", payload)} />}
      {bulk === "cancel" && <BulkCancelModal count={selected.size} busy={bulkBusy} onClose={() => setBulk(null)} onSubmit={(payload) => void runBulk("cancel", payload)} />}
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-apple-fill-secondary px-2 py-0.5 text-apple-text-secondary">
      {label}
      <button type="button" onClick={onClear} aria-label="Remove filter" className="rounded-full hover:text-apple-text"><X className="h-3 w-3" /></button>
    </span>
  );
}

function TriSelect({ label, value, onChange, yes, no }: { label: string; value: string; onChange: (v: string) => void; yes: string; no: string }) {
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Any</option>
      <option value="1">{yes}</option>
      <option value="0">{no}</option>
    </Select>
  );
}

function FiltersDrawer({ open, onClose, initial, tags, plans, onApply }: { open: boolean; onClose: () => void; initial: Filters; tags: Tag[]; plans: Plan[]; onApply: (f: Filters) => void }) {
  const [f, setF] = React.useState<Filters>(initial);
  React.useEffect(() => { if (open) setF(initial); }, [open, initial]);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Drawer open={open} onClose={onClose} title="Filter members" width="md" footer={
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={() => setF(EMPTY_FILTERS)}>Reset</Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onApply(f)}>Apply filters</Button>
        </div>
      </div>
    }>
      <div className="space-y-5">
        <Group title="Tags">
          {tags.length === 0 ? <p className="text-apple-xs text-apple-text-tertiary">No tags yet.</p> : (
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => {
                const on = f.tagIds.includes(t.id);
                return (
                  <button key={t.id} type="button" onClick={() => set("tagIds", on ? f.tagIds.filter((x) => x !== t.id) : [...f.tagIds, t.id])} className={`rounded-full border px-2.5 py-0.5 text-apple-xs font-medium ${on ? "border-transparent text-white" : "border-apple-border text-apple-text-secondary"}`} style={on ? { backgroundColor: t.color ?? "#16a34a" } : undefined}>
                    {t.name}{t.memberCount != null ? ` · ${t.memberCount}` : ""}
                  </button>
                );
              })}
            </div>
          )}
        </Group>
        <Group title="Membership">
          <Select label="Plan" value={f.planId} onChange={(e) => set("planId", e.target.value)}>
            <option value="">Any plan</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Range label="Membership start" from={f.membershipStartFrom} to={f.membershipStartTo} onFrom={(v) => set("membershipStartFrom", v)} onTo={(v) => set("membershipStartTo", v)} />
          <Range label="Membership end / paid through" from={f.membershipEndFrom} to={f.membershipEndTo} onFrom={(v) => set("membershipEndFrom", v)} onTo={(v) => set("membershipEndTo", v)} />
          <Range label="Joined" from={f.joinedFrom} to={f.joinedTo} onFrom={(v) => set("joinedFrom", v)} onTo={(v) => set("joinedTo", v)} />
        </Group>
        <Group title="Activity">
          <Range label="Last visit" from={f.lastVisitAfter} to={f.lastVisitBefore} onFrom={(v) => set("lastVisitAfter", v)} onTo={(v) => set("lastVisitBefore", v)} />
          <TriSelect label="Required documents" value={f.missingRequiredDoc} onChange={(v) => set("missingRequiredDoc", v)} yes="Missing a required doc" no="All signed" />
          <TriSelect label="Card on file" value={f.hasCard} onChange={(v) => set("hasCard", v)} yes="Has card" no="No card" />
        </Group>
        <Group title="Demographics">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Min age" type="number" min={0} value={f.minAge} onChange={(e) => set("minAge", e.target.value)} />
            <Input label="Max age" type="number" min={0} value={f.maxAge} onChange={(e) => set("maxAge", e.target.value)} />
          </div>
          <Select label="Birthday month" value={f.birthMonth} onChange={(e) => set("birthMonth", e.target.value)}>
            <option value="">Any month</option>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </Select>
          <Select label="Gender" value={f.gender} onChange={(e) => set("gender", e.target.value)}>
            <option value="">Any</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="nonbinary">Non-binary</option>
            <option value="other">Other</option>
          </Select>
        </Group>
        <Group title="Marketing">
          <TriSelect label="Email marketing" value={f.emailOptIn} onChange={(v) => set("emailOptIn", v)} yes="Opted in" no="Opted out" />
          <TriSelect label="SMS marketing" value={f.smsOptIn} onChange={(v) => set("smsOptIn", v)} yes="Opted in" no="Opted out" />
        </Group>
      </div>
    </Drawer>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-apple-xs font-semibold uppercase tracking-wide text-apple-text-tertiary">{title}</h3>
      {children}
    </section>
  );
}

function Range({ label, from, to, onFrom, onTo }: { label: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <div>
      <span className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">{label}</span>
      <div className="grid grid-cols-2 gap-2">
        <Input type="date" value={from} onChange={(e) => onFrom(e.target.value)} aria-label={`${label} from`} />
        <Input type="date" value={to} onChange={(e) => onTo(e.target.value)} aria-label={`${label} to`} />
      </div>
    </div>
  );
}

function BulkTagModal({ mode, tags, count, busy, onClose, onSubmit }: { mode: "addTag" | "removeTag"; tags: Tag[]; count: number; busy: boolean; onClose: () => void; onSubmit: (p: Record<string, unknown>) => void }) {
  const [tagId, setTagId] = React.useState(tags[0]?.id ?? "");
  const [newName, setNewName] = React.useState("");
  const creating = mode === "addTag" && tagId === "__new";
  return (
    <Modal open onClose={onClose} title={mode === "addTag" ? `Add tag to ${count} members` : `Remove tag from ${count} members`} footer={
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button loading={busy} disabled={creating ? !newName.trim() : !tagId} onClick={() => onSubmit(creating ? { tagName: newName.trim() } : { tagId })}>{mode === "addTag" ? "Add tag" : "Remove tag"}</Button>
      </div>
    }>
      <div className="space-y-3">
        <Select label="Tag" value={tagId} onChange={(e) => setTagId(e.target.value)}>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          {mode === "addTag" && <option value="__new">+ Create new tag…</option>}
        </Select>
        {creating && <Input label="New tag name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />}
      </div>
    </Modal>
  );
}

function BulkFreezeModal({ count, busy, onClose, onSubmit }: { count: number; busy: boolean; onClose: () => void; onSubmit: (p: Record<string, unknown>) => void }) {
  const [resumeDate, setResumeDate] = React.useState("");
  const [reason, setReason] = React.useState("");
  return (
    <Modal open onClose={onClose} title={`Freeze ${count} memberships`} description="Each member's current membership is frozen immediately until the resume date." footer={
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button loading={busy} disabled={!resumeDate} onClick={() => onSubmit({ resumeDate, reason: reason || undefined })}>Freeze</Button>
      </div>
    }>
      <div className="space-y-3">
        <Input label="Resume on" type="date" value={resumeDate} onChange={(e) => setResumeDate(e.target.value)} />
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}

function BulkCancelModal({ count, busy, onClose, onSubmit }: { count: number; busy: boolean; onClose: () => void; onSubmit: (p: Record<string, unknown>) => void }) {
  const [immediate, setImmediate] = React.useState(false);
  const [reason, setReason] = React.useState("Bulk cancellation");
  return (
    <Modal open onClose={onClose} title={`Cancel ${count} memberships?`} footer={
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Keep</Button>
        <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => onSubmit({ immediate, reason })}>Cancel memberships</Button>
      </div>
    }>
      <div className="space-y-3">
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Checkbox label="Cancel immediately (otherwise at end of paid period)" checked={immediate} onChange={setImmediate} />
        <Badge tone="warn">Members with no active membership are skipped.</Badge>
      </div>
    </Modal>
  );
}
