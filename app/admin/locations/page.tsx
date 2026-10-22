"use client";

import Link from "next/link";
import React from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, ChevronRight, MapPin, MonitorSmartphone, Plus, Settings2, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, useToast } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { errorFromResponse } from "@/components/admin/location-settings/useLocationSettings";

type LocationRow = { id: string; name: string; slug: string; disabled: boolean };

export default function LocationsIndexPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [rows, setRows] = React.useState<LocationRow[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [createErr, setCreateErr] = React.useState<string | null>(null);

  const [busySlug, setBusySlug] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<LocationRow | null>(null);

  const load = React.useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch("/api/admin/location-settings", { cache: "no-store" });
      if (!res.ok) throw await errorFromResponse(res, "Failed to load locations");
      const json = await res.json();
      const list: Array<Partial<LocationRow>> = json?.locations ?? [];
      setRows(list.map((r) => ({ id: String(r.id), name: String(r.name ?? ""), slug: String(r.slug ?? ""), disabled: Boolean(r.disabled) })));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load locations");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    const s = slug.trim().toLowerCase();
    if (!n) return setCreateErr("Name is required.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) return setCreateErr("Slug must be lowercase letters, numbers, and dashes.");
    setCreating(true);
    setCreateErr(null);
    try {
      const res = await fetch("/api/admin/locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: n, slug: s }),
      });
      if (!res.ok) throw await errorFromResponse(res, "Failed to create location");
      toast({ tone: "success", title: `${n} created` });
      setCreateOpen(false);
      setName("");
      setSlug("");
      setSlugTouched(false);
      router.push(adminRoutes.loc.dashboard(s));
      router.refresh();
    } catch (e: unknown) {
      setCreateErr(e instanceof Error ? e.message : "Failed to create location");
    } finally {
      setCreating(false);
    }
  }

  async function toggleDisabled(r: LocationRow) {
    setBusySlug(r.slug);
    try {
      const res = await fetch(`/api/admin/locations/${encodeURIComponent(r.slug)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disabled: !r.disabled }),
      });
      if (!res.ok) throw await errorFromResponse(res, "Failed to update location");
      toast({ tone: "success", title: r.disabled ? `${r.name} enabled` : `${r.name} disabled` });
      await load();
      router.refresh();
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't update location", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusySlug(null);
    }
  }

  async function remove() {
    if (!confirmDelete) return;
    const r = confirmDelete;
    setBusySlug(r.slug);
    try {
      const res = await fetch(`/api/admin/locations/${encodeURIComponent(r.slug)}`, { method: "DELETE" });
      if (!res.ok) throw await errorFromResponse(res, "Failed to delete location");
      toast({ tone: "success", title: `${r.name} deleted` });
      setConfirmDelete(null);
      await load();
      router.refresh();
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't delete location", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusySlug(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Locations"
        description="Pick a location to manage its bookings, bays, members, and settings."
        actions={
          <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
            New location
          </Button>
        }
      />

      {err && (
        <div className="flex flex-col gap-2 rounded-apple border border-apple-red/30 bg-apple-red/5 p-4 text-apple-sm text-apple-red sm:flex-row sm:items-center">
          <span className="flex-1">{err}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      {!rows && !err && (
        <div className="grid animate-pulse gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-36 rounded-apple border border-apple-divider bg-white" />
          ))}
        </div>
      )}

      {rows && rows.length === 0 && (
        <EmptyState
          icon={<Building2 className="h-6 w-6" />}
          title="No locations yet"
          description="Create your first location to start taking bookings."
          action={
            <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
              New location
            </Button>
          }
        />
      )}

      {rows && rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <Card key={r.id} className={r.disabled ? "opacity-75" : ""}>
              <Link href={adminRoutes.loc.dashboard(r.slug)} className="group flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-apple-sm bg-apple-blue/10 text-apple-blue">
                  <MapPin className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-apple-base font-semibold text-apple-text group-hover:text-apple-blue">{r.name}</span>
                  <span className="block truncate font-mono text-apple-xs text-apple-text-tertiary">/{r.slug}</span>
                </span>
                <span className="flex items-center gap-2">
                  {r.disabled ? <Badge tone="danger" size="sm">Disabled</Badge> : <Badge tone="success" size="sm">Live</Badge>}
                  <ChevronRight className="h-4 w-4 text-apple-text-tertiary" />
                </span>
              </Link>

              <div className="mt-4 grid grid-cols-3 gap-1 border-t border-apple-divider pt-3">
                <ShortcutLink href={adminRoutes.loc.scheduling.bookings(r.slug)} label="Bookings" icon={<CalendarDays className="h-4 w-4" />} />
                <ShortcutLink href={adminRoutes.loc.scheduling.bays(r.slug)} label="Bays" icon={<MonitorSmartphone className="h-4 w-4" />} />
                <ShortcutLink href={adminRoutes.loc.root(r.slug)} label="Settings" icon={<Settings2 className="h-4 w-4" />} />
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-apple-divider pt-3">
                <Button variant="ghost" size="sm" onClick={() => void toggleDisabled(r)} loading={busySlug === r.slug}>
                  {r.disabled ? "Enable" : "Disable"}
                </Button>
                <Button variant="ghost" size="sm" className="text-apple-text-tertiary hover:text-apple-red" onClick={() => setConfirmDelete(r)} iconLeft={<Trash2 className="h-3.5 w-3.5" />}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create */}
      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title="New location"
        description="You can change the name later; the slug appears in booking links."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button form="create-location" type="submit" loading={creating}>
              Create location
            </Button>
          </div>
        }
      >
        <form id="create-location" onSubmit={create} className="space-y-4">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tee24 Clarksville" autoFocus required />
          <Input
            label="Slug"
            className="font-mono"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
            placeholder="clarksville"
            hint="Lowercase letters, numbers, and dashes."
            required
          />
          {createErr && <p className="text-apple-sm text-apple-red">{createErr}</p>}
        </form>
      </Modal>

      {/* Delete */}
      <Modal
        open={confirmDelete !== null}
        onClose={() => busySlug === null && setConfirmDelete(null)}
        title={confirmDelete ? `Delete ${confirmDelete.name}?` : "Delete location"}
        description="This cannot be undone. Deletion fails if the location still has bays or bookings — disable it instead to hide it."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setConfirmDelete(null)} disabled={busySlug !== null}>
              Keep location
            </Button>
            <Button variant="danger" onClick={() => void remove()} loading={busySlug !== null} iconLeft={<Trash2 className="h-4 w-4" />}>
              Delete location
            </Button>
          </div>
        }
      >
        <span className="sr-only">Confirm deletion</span>
      </Modal>
    </div>
  );
}

function ShortcutLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex h-12 flex-col items-center justify-center gap-0.5 rounded-apple-sm text-[10px] font-medium text-apple-text-secondary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text sm:h-11"
    >
      {icon}
      {label}
    </Link>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/^tee\s*24\s*/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
