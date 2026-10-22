"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ListTodo, Pencil, Plus, RotateCcw, Search, Trash2, User, X } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, Select, StatusBadge, Textarea, useToast } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";

export type AdminLite = { id: string; name: string | null; phone: string };
export type LocationLite = { id: string; name: string; slug: string };
export type MemberChip = { id: string; firstName: string; lastName: string; phone: string; locationSlug: string };
export type TaskDTO = {
  id: string;
  title: string;
  body: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  memberId: string | null;
  assignedToId: string | null;
  locationId: string | null;
  createdById: string | null;
  completedAt: string | null;
  createdAt: string;
  assignee: { id: string; name: string | null; phone: string } | null;
  location: { id: string; name: string; slug: string } | null;
  member: MemberChip | null;
};

export type Filters = { assignee: string; status: string; due: string; locationId: string; q: string };

type Draft = {
  title: string;
  body: string;
  assignedToId: string;
  locationId: string;
  priority: string;
  dueAt: string;
  member: MemberChip | null;
};

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyDraft(locations: LocationLite[]): Draft {
  return { title: "", body: "", assignedToId: "", locationId: locations[0]?.id ?? "", priority: "NORMAL", dueAt: "", member: null };
}

function dueLabel(iso: string | null, status: string) {
  if (!iso) return { text: "No due date", tone: "muted" as const };
  const d = new Date(iso);
  const now = new Date();
  const done = status === "DONE" || status === "CANCELLED";
  const sameDay = d.toDateString() === now.toDateString();
  const text = sameDay ? `Today ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  if (!done && d < now) return { text: `Overdue · ${text}`, tone: "danger" as const };
  if (sameDay) return { text, tone: "warn" as const };
  return { text, tone: "muted" as const };
}

export function TasksClient({
  tasks: initial,
  admins,
  locations,
  filters,
  meId,
  canManage,
}: {
  tasks: TaskDTO[];
  admins: AdminLite[];
  locations: LocationLite[];
  filters: Filters;
  meId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tasks, setTasks] = React.useState(initial);
  React.useEffect(() => setTasks(initial), [initial]);

  const [editing, setEditing] = React.useState<TaskDTO | null | "new">(null);
  const [draft, setDraft] = React.useState<Draft>(() => emptyDraft(locations));
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState<TaskDTO | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  function openNew() {
    setDraft(emptyDraft(locations));
    setEditing("new");
  }
  function openEdit(t: TaskDTO) {
    setDraft({ title: t.title, body: t.body ?? "", assignedToId: t.assignedToId ?? "", locationId: t.locationId ?? "", priority: t.priority, dueAt: toLocalInput(t.dueAt), member: t.member });
    setEditing(t);
  }

  function applyFilters(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    router.push(`${adminRoutes.tasks()}?${p.toString()}`);
  }

  async function save() {
    if (!draft.title.trim()) return toast({ tone: "error", title: "Title is required" });
    setSaving(true);
    try {
      const payload = {
        title: draft.title.trim(),
        body: draft.body.trim() || null,
        assignedToId: draft.assignedToId || null,
        locationId: draft.locationId || null,
        memberId: draft.member?.id ?? null,
        priority: draft.priority,
        dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
      };
      const res = await fetch("/api/admin/tasks", {
        method: editing === "new" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing === "new" ? payload : { id: (editing as TaskDTO).id, ...payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      toast({ tone: "success", title: editing === "new" ? "Task added" : "Task updated" });
      setEditing(null);
      router.refresh();
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't save task", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(t: TaskDTO, status: "DONE" | "OPEN") {
    setBusy(t.id);
    try {
      const res = await fetch("/api/admin/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, status }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status, completedAt: status === "DONE" ? new Date().toISOString() : null } : x)));
      router.refresh();
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't update task", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!deleting) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tasks?id=${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setTasks((prev) => prev.filter((x) => x.id !== deleting.id));
      setDeleting(null);
      toast({ tone: "success", title: "Task deleted" });
      router.refresh();
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't delete task", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  const title =
    filters.assignee === "me" ? "My tasks" : filters.assignee === "unassigned" ? "Unassigned tasks" : filters.assignee === "all" ? "All tasks" : `Tasks for ${admins.find((a) => a.id === filters.assignee)?.name ?? "teammate"}`;

  return (
    <>
      <Card padded={false}>
        <CardHeader
          title={title}
          subtitle={`${tasks.length} ${filters.status === "done" ? "completed" : filters.status === "all" ? "total" : "open"}`}
          className="p-5 pb-3"
          action={canManage ? <Button size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={openNew}>New task</Button> : undefined}
        />

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-2 border-b border-apple-divider px-5 pb-4">
          <div className="inline-flex rounded-apple-pill border border-apple-border bg-white p-0.5">
            {[
              { v: "me", l: "Mine" },
              { v: "unassigned", l: "Unassigned" },
              { v: "all", l: "Everyone" },
            ].map((o) => (
              <button key={o.v} type="button" onClick={() => applyFilters({ assignee: o.v })} className={`rounded-apple-pill px-3 py-1 text-apple-xs font-medium ${filters.assignee === o.v ? "bg-apple-text text-white" : "text-apple-text-secondary hover:text-apple-text"}`}>
                {o.l}
              </button>
            ))}
          </div>
          <select value={["me", "unassigned", "all"].includes(filters.assignee) ? "" : filters.assignee} onChange={(e) => e.target.value && applyFilters({ assignee: e.target.value })} className="input !w-auto !py-1.5 text-apple-xs" aria-label="Assignee">
            <option value="">Teammate…</option>
            {admins.map((a) => <option key={a.id} value={a.id}>{a.name ?? a.phone}{a.id === meId ? " (me)" : ""}</option>)}
          </select>
          <select value={filters.status} onChange={(e) => applyFilters({ status: e.target.value })} className="input !w-auto !py-1.5 text-apple-xs" aria-label="Status">
            <option value="open">Open</option>
            <option value="done">Completed</option>
            <option value="all">All statuses</option>
          </select>
          <select value={filters.due} onChange={(e) => applyFilters({ due: e.target.value })} className="input !w-auto !py-1.5 text-apple-xs" aria-label="Due">
            <option value="all">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="week">Due this week</option>
            <option value="none">No due date</option>
          </select>
          {locations.length > 1 && (
            <select value={filters.locationId} onChange={(e) => applyFilters({ locationId: e.target.value })} className="input !w-auto !py-1.5 text-apple-xs" aria-label="Location">
              <option value="">All locations</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              applyFilters({ q: (new FormData(e.currentTarget).get("q") as string) ?? "" });
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-apple-text-tertiary" />
            <input name="q" defaultValue={filters.q} placeholder="Search tasks" className="input !w-44 !py-1.5 !pl-8 text-apple-xs" />
          </form>
        </div>

        {tasks.length === 0 ? (
          <EmptyState icon={<ListTodo className="h-6 w-6" />} title="Nothing here" description={filters.assignee === "me" && filters.status === "open" ? "You have no open tasks. Try “Everyone” or “Unassigned”." : "No tasks match these filters."} />
        ) : (
          <ul className="divide-y divide-apple-divider">
            {tasks.map((t) => {
              const done = t.status === "DONE" || t.status === "CANCELLED";
              const due = dueLabel(t.dueAt, t.status);
              return (
                <li key={t.id} className={`group flex items-start gap-3 px-5 py-3 ${done ? "opacity-60" : ""}`}>
                  <button
                    type="button"
                    onClick={() => void setStatus(t, done ? "OPEN" : "DONE")}
                    disabled={busy === t.id}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${done ? "border-apple-green bg-apple-green text-white" : "border-apple-border text-transparent hover:border-apple-green hover:text-apple-green"}`}
                    aria-label={done ? "Reopen" : "Mark done"}
                    title={done ? "Reopen" : "Mark done"}
                  >
                    {done ? <><Check className="h-3 w-3 group-hover:hidden" /><RotateCcw className="hidden h-3 w-3 group-hover:block" /></> : <Check className="h-3 w-3" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-apple-sm font-medium text-apple-text ${done ? "line-through" : ""}`}>{t.title}</span>
                      {(t.priority === "HIGH" || t.priority === "URGENT") && <Badge tone="danger" size="sm">{t.priority.toLowerCase()}</Badge>}
                      {t.status === "IN_PROGRESS" && <StatusBadge status={t.status} size="sm" />}
                    </div>
                    {t.body && <div className="mt-0.5 line-clamp-2 text-apple-sm text-apple-text-secondary">{t.body}</div>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-apple-xs text-apple-text-tertiary">
                      <Badge tone={due.tone} size="sm">{due.text}</Badge>
                      <span>{t.assignee ? (t.assignee.id === meId ? "Me" : t.assignee.name ?? t.assignee.phone) : "Unassigned"}</span>
                      {t.location && <span>· {t.location.name}</span>}
                      {t.member && (
                        <Link href={adminRoutes.loc.members.detail(t.member.locationSlug, t.member.id)} className="inline-flex items-center gap-1 rounded-apple-pill bg-apple-blue/10 px-2 py-0.5 font-medium text-apple-blue hover:bg-apple-blue/20">
                          <User className="h-3 w-3" /> {t.member.firstName} {t.member.lastName}
                        </Link>
                      )}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button type="button" onClick={() => openEdit(t)} className="rounded-apple-sm p-1.5 text-apple-text-tertiary hover:bg-apple-fill-secondary hover:text-apple-text" aria-label="Edit" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setDeleting(t)} className="rounded-apple-sm p-1.5 text-apple-text-tertiary hover:bg-apple-red/10 hover:text-apple-red" aria-label="Delete" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Create / edit modal */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New task" : "Edit task"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => void save()} loading={saving}>{editing === "new" ? "Add task" : "Save changes"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="Title" required autoFocus value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
          <Textarea label="Notes" rows={3} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Assignee" value={draft.assignedToId} onChange={(e) => setDraft((d) => ({ ...d, assignedToId: e.target.value }))}>
              <option value="">— Unassigned —</option>
              {admins.map((a) => <option key={a.id} value={a.id}>{a.name ?? a.phone}{a.id === meId ? " (me)" : ""}</option>)}
            </Select>
            <Select label="Location" value={draft.locationId} onChange={(e) => setDraft((d) => ({ ...d, locationId: e.target.value, member: d.member && locations.find((l) => l.id === e.target.value)?.slug !== d.member.locationSlug ? null : d.member }))}>
              <option value="">— None —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Select label="Priority" value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}>
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </Select>
            <Input label="Due" type="datetime-local" value={draft.dueAt} onChange={(e) => setDraft((d) => ({ ...d, dueAt: e.target.value }))} />
          </div>
          <MemberPicker
            locationSlug={locations.find((l) => l.id === draft.locationId)?.slug ?? null}
            value={draft.member}
            onChange={(m) => setDraft((d) => ({ ...d, member: m }))}
          />
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete task?"
        description={deleting ? `“${deleting.title}” will be permanently removed.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void remove()} loading={saving}>Delete</Button>
          </>
        }
      >
        <p className="text-apple-sm text-apple-text-secondary">This can&apos;t be undone. Completed tasks are kept in history unless deleted.</p>
      </Modal>
    </>
  );
}

/* ───────────────────────── Member picker (search) ─────────────────────── */

function MemberPicker({ locationSlug, value, onChange }: { locationSlug: string | null; value: MemberChip | null; onChange: (m: MemberChip | null) => void }) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<MemberChip[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!locationSlug || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/members?locationSlug=${encodeURIComponent(locationSlug)}&q=${encodeURIComponent(q.trim())}&limit=8`, { signal: ctrl.signal, cache: "no-store" });
        const json = await res.json();
        const items = (json.items ?? json.members ?? []) as { id: string; firstName: string; lastName: string; phone: string }[];
        setResults(items.map((m) => ({ id: m.id, firstName: m.firstName, lastName: m.lastName, phone: m.phone, locationSlug })));
      } catch {
        /* aborted or failed — keep previous */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, locationSlug]);

  return (
    <div>
      <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Linked member</label>
      {value ? (
        <div className="flex items-center justify-between rounded-apple-sm border border-apple-border bg-apple-fill-secondary/50 px-3 py-2 text-apple-sm">
          <span className="flex items-center gap-2">
            <User className="h-4 w-4 text-apple-text-tertiary" />
            <span className="font-medium">{value.firstName} {value.lastName}</span>
            <span className="font-mono text-apple-xs text-apple-text-tertiary">{value.phone}</span>
          </span>
          <button type="button" onClick={() => onChange(null)} className="rounded-apple-sm p-1 text-apple-text-tertiary hover:text-apple-red" aria-label="Unlink member">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : !locationSlug ? (
        <p className="text-apple-xs text-apple-text-tertiary">Pick a location to link a member.</p>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-apple-text-tertiary" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone" className="input w-full !pl-9" />
          {(results.length > 0 || loading) && q.trim().length >= 2 && (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-apple border border-apple-border bg-white py-1 shadow-apple-md">
              {loading && results.length === 0 && <li className="px-3 py-2 text-apple-xs text-apple-text-tertiary">Searching…</li>}
              {results.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => { onChange(m); setQ(""); }} className="flex w-full items-center justify-between px-3 py-2 text-left text-apple-sm hover:bg-apple-fill-secondary">
                    <span>{m.firstName} {m.lastName}</span>
                    <span className="font-mono text-apple-xs text-apple-text-tertiary">{m.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
