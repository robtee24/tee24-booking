"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Pencil, Plus, Star, Trash2, Users } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, Select, StatusBadge, Textarea, useToast } from "@/components/ui";

export type EventDTO = {
  id: string;
  locationId: string | null;
  title: string;
  description: string | null;
  kind: string;
  startsAt: string;
  endsAt: string | null;
  scheduleNote: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  leagueId: number | null;
  capacity: number | null;
  published: boolean;
  featured: boolean;
  going: number;
};

type League = { id: number; name: string };

const KINDS = [
  { key: "LEAGUE", label: "League play" },
  { key: "CLINIC", label: "Clinic / lesson" },
  { key: "TOURNAMENT", label: "Tournament" },
  { key: "SOCIAL", label: "Social" },
  { key: "OTHER", label: "Other" },
];

type Draft = {
  title: string;
  description: string;
  kind: string;
  startsAt: string;
  endsAt: string;
  scheduleNote: string;
  imageUrl: string;
  ctaLabel: string;
  ctaUrl: string;
  leagueId: string;
  capacity: string;
  published: boolean;
  featured: boolean;
  orgWide: boolean;
};

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const empty = (): Draft => ({ title: "", description: "", kind: "LEAGUE", startsAt: "", endsAt: "", scheduleNote: "", imageUrl: "", ctaLabel: "", ctaUrl: "", leagueId: "", capacity: "", published: true, featured: false, orgWide: false });

const fmtRange = (s: string, e: string | null) => {
  const sd = new Date(s);
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  let out = sd.toLocaleString(undefined, opts);
  if (e) {
    const ed = new Date(e);
    out += ed.toDateString() === sd.toDateString() ? ` – ${ed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ` → ${ed.toLocaleString(undefined, opts)}`;
  }
  return out;
};

export function EventsClient({ events, locationId, leagues, canCreateOrgWide, leagueLinked }: { events: EventDTO[]; locationId: string; leagues: League[]; canCreateOrgWide: boolean; leagueLinked: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<EventDTO | "new" | null>(null);
  const [draft, setDraft] = React.useState<Draft>(empty);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState<EventDTO | null>(null);
  const [tab, setTab] = React.useState<"upcoming" | "past">("upcoming");

  const now = Date.now();
  const list = events.filter((e) => (tab === "upcoming" ? new Date(e.endsAt ?? e.startsAt).getTime() >= now - 3600_000 : new Date(e.endsAt ?? e.startsAt).getTime() < now - 3600_000));
  if (tab === "upcoming") list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  function openNew() {
    setDraft(empty());
    setEditing("new");
  }
  function openEdit(e: EventDTO) {
    setDraft({
      title: e.title,
      description: e.description ?? "",
      kind: e.kind,
      startsAt: toLocalInput(e.startsAt),
      endsAt: toLocalInput(e.endsAt),
      scheduleNote: e.scheduleNote ?? "",
      imageUrl: e.imageUrl ?? "",
      ctaLabel: e.ctaLabel ?? "",
      ctaUrl: e.ctaUrl ?? "",
      leagueId: e.leagueId?.toString() ?? "",
      capacity: e.capacity?.toString() ?? "",
      published: e.published,
      featured: e.featured,
      orgWide: e.locationId === null,
    });
    setEditing(e);
  }

  async function save() {
    if (!draft.title.trim()) return toast({ tone: "error", title: "Title is required" });
    if (!draft.startsAt) return toast({ tone: "error", title: "Start date is required" });
    setSaving(true);
    try {
      const payload = {
        locationId: draft.orgWide ? null : locationId,
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        kind: draft.kind,
        startsAt: new Date(draft.startsAt).toISOString(),
        endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
        scheduleNote: draft.scheduleNote.trim() || null,
        imageUrl: draft.imageUrl.trim() || null,
        ctaLabel: draft.ctaLabel.trim() || null,
        ctaUrl: draft.ctaUrl.trim() || null,
        leagueId: draft.kind === "LEAGUE" && draft.leagueId ? Number(draft.leagueId) : null,
        capacity: draft.capacity ? Number(draft.capacity) : null,
        published: draft.published,
        featured: draft.featured,
      };
      const res = await fetch("/api/admin/events", {
        method: editing === "new" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing === "new" ? payload : { id: (editing as EventDTO).id, ...payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      toast({ tone: "success", title: editing === "new" ? "Event added" : "Event updated" });
      setEditing(null);
      router.refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save event", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function remove(e: EventDTO) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/events", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      toast({ tone: "success", title: "Event deleted" });
      setDeleting(null);
      router.refresh();
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete event", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function toggle(e: EventDTO, patch: Partial<Pick<EventDTO, "published" | "featured">>) {
    const res = await fetch("/api/admin/events", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id, ...patch }) });
    if (!res.ok) toast({ tone: "error", title: "Couldn't update event" });
    router.refresh();
  }

  return (
    <>
      <Card padded={false}>
        <CardHeader
          className="p-5"
          title={tab === "upcoming" ? "Upcoming" : "Past"}
          subtitle={tab === "upcoming" ? `${list.length} scheduled` : `${list.length} past events`}
          action={
            <div className="flex items-center gap-2">
              <div className="flex rounded-apple-sm border border-apple-border p-0.5 text-apple-xs">
                {(["upcoming", "past"] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={["rounded px-2.5 py-1 capitalize", tab === t ? "bg-apple-fill-secondary font-medium text-apple-text" : "text-apple-text-secondary"].join(" ")}>
                    {t}
                  </button>
                ))}
              </div>
              <Button size="sm" iconLeft={<Plus size={14} />} onClick={openNew}>
                New event
              </Button>
            </div>
          }
        />
        {list.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<CalendarDays size={20} />} title={tab === "upcoming" ? "Nothing scheduled" : "No past events"} description="Events appear in the member app under Events. Add league nights, clinics and socials here." action={tab === "upcoming" ? <Button size="sm" iconLeft={<Plus size={14} />} onClick={openNew}>New event</Button> : undefined} />
          </div>
        ) : (
          <ul className="divide-y divide-apple-divider">
            {list.map((e) => (
              <li key={e.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-apple-text">{e.title}</span>
                    <StatusBadge status={e.kind} size="sm" />
                    {e.featured && (
                      <Badge tone="warn" size="sm">
                        <Star size={10} /> Featured
                      </Badge>
                    )}
                    {!e.published && <Badge tone="muted" size="sm">Draft</Badge>}
                    {e.locationId === null && <Badge tone="info" size="sm">All locations</Badge>}
                    {e.leagueId != null && <Badge tone="success" size="sm">Scores in app</Badge>}
                  </div>
                  <div className="mt-1 text-apple-sm text-apple-text-secondary">
                    {fmtRange(e.startsAt, e.endsAt)}
                    {e.scheduleNote ? ` · ${e.scheduleNote}` : ""}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-apple-xs text-apple-text-tertiary">
                    <Users size={12} /> {e.going} going{e.capacity ? ` of ${e.capacity}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => toggle(e, { featured: !e.featured })} title={e.featured ? "Unfeature" : "Feature"}>
                    <Star size={14} className={e.featured ? "fill-current text-apple-orange" : ""} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggle(e, { published: !e.published })}>
                    {e.published ? "Unpublish" : "Publish"}
                  </Button>
                  <Button variant="ghost" size="sm" iconLeft={<Pencil size={14} />} onClick={() => openEdit(e)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(e)} title="Delete">
                    <Trash2 size={14} className="text-apple-red" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New event" : "Edit event"}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button loading={saving} onClick={save}>{editing === "new" ? "Add event" : "Save changes"}</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Title" value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Winter League · Tuesday nights" />
          </div>
          <Select label="Type" value={draft.kind} onChange={(e) => set("kind", e.target.value)}>
            {KINDS.map((k) => (
              <option key={k.key} value={k.key}>{k.label}</option>
            ))}
          </Select>
          {draft.kind === "LEAGUE" ? (
            leagueLinked ? (
              <Select label="League (for in-app score submission)" value={draft.leagueId} onChange={(e) => set("leagueId", e.target.value)} hint={leagues.length ? "Members on the roster can submit scores from the app." : "No leagues found in the league app."}>
                <option value="">Not linked</option>
                {leagues.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            ) : (
              <Input label="League id" value={draft.leagueId} onChange={(e) => set("leagueId", e.target.value)} hint="Set LEAGUE_API_BASE to pick from a list." inputMode="numeric" />
            )
          ) : (
            <Input label="Capacity (optional)" value={draft.capacity} onChange={(e) => set("capacity", e.target.value)} inputMode="numeric" placeholder="e.g. 16" />
          )}
          <Input label="Starts" type="datetime-local" value={draft.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
          <Input label="Ends (optional)" type="datetime-local" value={draft.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
          <div className="sm:col-span-2">
            <Input label="Schedule note" value={draft.scheduleNote} onChange={(e) => set("scheduleNote", e.target.value)} placeholder="Every Tuesday 6–9pm through Mar 3" hint="Shown under the date in the app for recurring events." />
          </div>
          <div className="sm:col-span-2">
            <Textarea label="Description" rows={4} value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder="Format, cost, who it's for, how to sign up…" />
          </div>
          <Input label="Image URL (optional)" value={draft.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://…" />
          {draft.kind === "LEAGUE" && <Input label="Capacity (optional)" value={draft.capacity} onChange={(e) => set("capacity", e.target.value)} inputMode="numeric" />}
          <Input label="Button label (optional)" value={draft.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} placeholder="Sign up" />
          <Input label="Button link (optional)" value={draft.ctaUrl} onChange={(e) => set("ctaUrl", e.target.value)} placeholder="https://…" />
          <div className="flex flex-wrap items-center gap-5 sm:col-span-2">
            <label className="flex items-center gap-2 text-apple-sm text-apple-text">
              <input type="checkbox" checked={draft.published} onChange={(e) => set("published", e.target.checked)} /> Published
            </label>
            <label className="flex items-center gap-2 text-apple-sm text-apple-text">
              <input type="checkbox" checked={draft.featured} onChange={(e) => set("featured", e.target.checked)} /> Featured at top
            </label>
            {canCreateOrgWide && (
              <label className="flex items-center gap-2 text-apple-sm text-apple-text">
                <input type="checkbox" checked={draft.orgWide} onChange={(e) => set("orgWide", e.target.checked)} /> Show at all locations
              </label>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete event"
        description={deleting ? `"${deleting.title}" will be removed from the app along with ${deleting.going} RSVP${deleting.going === 1 ? "" : "s"}.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" loading={saving} onClick={() => deleting && remove(deleting)}>Delete</Button>
          </>
        }
      >
        <p className="text-apple-sm text-apple-text-secondary">You can unpublish instead if you want to hide it temporarily.</p>
      </Modal>
    </>
  );
}
