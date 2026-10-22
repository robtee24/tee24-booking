"use client";

/**
 * Door Access — live Kisi door status, remote unlock, and door → location assignment.
 */
import React from "react";
import Link from "next/link";
import { DoorOpen, Lock, LockOpen, RefreshCw, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Modal, Select, useToast } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";

export type DoorRow = {
  id: string;
  kisiLockId: number;
  name: string;
  description: string | null;
  kisiPlaceId: number | null;
  kisiPlaceName: string | null;
  locationId: string | null;
  location: { id: string; name: string; slug: string } | null;
  online: boolean | null;
  configured: boolean | null;
  unlocked: boolean | null;
  open: boolean | null;
  lockedDown: boolean | null;
  lastStatusAt: string | null;
  lastUnlockAt: string | null;
  hidden: boolean;
  checkInsToday: number;
};

type LocationOpt = { id: string; name: string; slug: string };

function relTime(iso: string | null) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(iso).toLocaleDateString();
}

export function DoorAccessClient({
  initialDoors,
  locations,
  kisiConfigured,
  canManage,
  canUnlockAny,
}: {
  initialDoors: DoorRow[];
  locations: LocationOpt[];
  kisiConfigured: boolean;
  canManage: boolean;
  canUnlockAny: boolean;
}) {
  const { toast } = useToast();
  const [doors, setDoors] = React.useState<DoorRow[]>(initialDoors);
  const [refreshing, setRefreshing] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [confirm, setConfirm] = React.useState<DoorRow | null>(null);
  const [unlocking, setUnlocking] = React.useState<string | null>(null);
  const [showHidden, setShowHidden] = React.useState(false);

  const reload = React.useCallback(
    async (refresh: boolean) => {
      const res = await fetch(`/api/admin/doors${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setDoors(data.doors ?? []);
      return data;
    },
    []
  );

  // Auto-refresh status every 30s while the page is open.
  React.useEffect(() => {
    if (!kisiConfigured) return;
    const t = setInterval(() => void reload(true), 30_000);
    return () => clearInterval(t);
  }, [kisiConfigured, reload]);

  async function refreshStatus() {
    setRefreshing(true);
    try {
      const d = await reload(true);
      if (!d.refreshed) toast({ tone: "info", title: "Status unchanged", description: "Kisi not configured or unreachable." });
    } finally {
      setRefreshing(false);
    }
  }

  async function syncFromKisi() {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/doors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      toast({ tone: "success", title: "Doors synced", description: `${data.synced} doors from Kisi (${data.created} new)` });
      await reload(false);
    } catch (e) {
      toast({ tone: "error", title: "Sync failed", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSyncing(false);
    }
  }

  async function assign(door: DoorRow, locationId: string) {
    const prev = doors;
    setDoors((ds) =>
      ds.map((d) =>
        d.id === door.id ? { ...d, locationId: locationId || null, location: locations.find((l) => l.id === locationId) ?? null } : d
      )
    );
    const res = await fetch(`/api/admin/doors/${door.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId: locationId || null }),
    });
    if (!res.ok) {
      setDoors(prev);
      const data = await res.json().catch(() => ({}));
      toast({ tone: "error", title: "Couldn't assign door", description: data.error });
    } else {
      toast({ tone: "success", title: locationId ? `Assigned to ${locations.find((l) => l.id === locationId)?.name}` : "Unassigned" });
    }
  }

  async function toggleHidden(door: DoorRow) {
    const res = await fetch(`/api/admin/doors/${door.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: !door.hidden }),
    });
    if (res.ok) setDoors((ds) => ds.map((d) => (d.id === door.id ? { ...d, hidden: !d.hidden } : d)));
  }

  async function unlock(door: DoorRow) {
    setUnlocking(door.id);
    try {
      const res = await fetch(`/api/admin/doors/${door.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlock" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unlock failed");
      toast({ tone: "success", title: `${door.name} unlocked`, description: data.message });
      setDoors((ds) => ds.map((d) => (d.id === door.id ? { ...d, unlocked: true, lastUnlockAt: new Date().toISOString() } : d)));
      setTimeout(() => void reload(true), 8000);
    } catch (e) {
      toast({ tone: "error", title: `Couldn't unlock ${door.name}`, description: e instanceof Error ? e.message : String(e) });
    } finally {
      setUnlocking(null);
      setConfirm(null);
    }
  }

  const visible = doors.filter((d) => showHidden || !d.hidden);
  const groups = React.useMemo(() => {
    const map = new Map<string, DoorRow[]>();
    for (const d of visible) {
      const key = d.kisiPlaceName ?? (d.kisiPlaceId != null ? `Place ${d.kisiPlaceId}` : "Other");
      map.set(key, [...(map.get(key) ?? []), d]);
    }
    return Array.from(map.entries());
  }, [visible]);

  const online = visible.filter((d) => d.online === true).length;
  const offline = visible.filter((d) => d.online === false).length;
  const unassigned = visible.filter((d) => !d.locationId).length;
  const lastStatus = visible.reduce<string | null>((acc, d) => (d.lastStatusAt && (!acc || d.lastStatusAt > acc) ? d.lastStatusAt : acc), null);

  return (
    <div className="space-y-6">
      {!kisiConfigured && (
        <Card className="border border-apple-orange/30 bg-apple-orange/5">
          <CardHeader
            title="Connect Kisi"
            subtitle="Door status, remote unlock and check-in tracking all run through the Kisi API. One-time setup:"
          />
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-apple-sm text-apple-text">
            <li>
              In Kisi (web.kisi.io) open <strong>Organization → API</strong> (or your profile → <strong>API keys</strong>) and create a key for an
              admin account that can see every place.
            </li>
            <li>
              Add it to the server environment as <code className="rounded bg-apple-fill-secondary px-1">KISI_API_KEY</code> and redeploy.
            </li>
            <li>
              Optional: in Kisi, add an <strong>Event webhook</strong> integration pointing at{" "}
              <code className="rounded bg-apple-fill-secondary px-1">/api/webhooks/kisi</code> for instant check-ins (store its secret as{" "}
              <code className="rounded bg-apple-fill-secondary px-1">KISI_WEBHOOK_SECRET</code>). Without it, unlocks are pulled every 5 minutes.
            </li>
            <li>Come back here, click <strong>Sync from Kisi</strong>, then assign each door to a location.</li>
          </ol>
        </Card>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-apple-sm text-apple-text-secondary">
          <Badge tone="success"><Wifi className="h-3 w-3" /> {online} online</Badge>
          <Badge tone={offline ? "danger" : "muted"}><WifiOff className="h-3 w-3" /> {offline} offline</Badge>
          {unassigned > 0 && <Badge tone="warn">{unassigned} unassigned</Badge>}
          {lastStatus && <span className="text-apple-xs text-apple-text-tertiary">Status as of {relTime(lastStatus)}</span>}
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <label className="mr-2 flex items-center gap-1.5 text-apple-xs text-apple-text-secondary">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden
            </label>
          )}
          <Button variant="secondary" size="sm" loading={refreshing} onClick={refreshStatus} disabled={!kisiConfigured} iconLeft={<RefreshCw className="h-3.5 w-3.5" />}>
            Refresh status
          </Button>
          {canManage && (
            <Button size="sm" loading={syncing} onClick={syncFromKisi} disabled={!kisiConfigured}>
              Sync from Kisi
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<DoorOpen className="h-6 w-6" />}
          title="No doors yet"
          description={kisiConfigured ? "Click “Sync from Kisi” to import your doors." : "Connect Kisi to import your doors."}
          action={
            canManage && kisiConfigured ? (
              <Button loading={syncing} onClick={syncFromKisi}>Sync from Kisi</Button>
            ) : undefined
          }
        />
      ) : (
        groups.map(([place, list]) => (
          <Card key={place} padded={false}>
            <div className="px-5 pt-5">
              <CardHeader title={place} subtitle={`${list.length} door${list.length === 1 ? "" : "s"} · Kisi place`} />
            </div>
            <ul className="mt-4 divide-y divide-apple-divider border-t border-apple-divider">
              {list.map((d) => {
                const canUnlock = canUnlockAny || Boolean(d.locationId);
                return (
                  <li key={d.id} className={["flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center", d.hidden ? "opacity-60" : ""].join(" ")}>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div
                        className={[
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                          d.lockedDown
                            ? "bg-apple-red/10 text-apple-red"
                            : d.unlocked
                              ? "bg-apple-green/10 text-apple-green"
                              : "bg-apple-fill-secondary text-apple-text-secondary",
                        ].join(" ")}
                      >
                        {d.lockedDown ? <ShieldAlert className="h-5 w-5" /> : d.unlocked ? <LockOpen className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium text-apple-text">{d.name}</span>
                          <StatusBadges d={d} />
                        </div>
                        <div className="text-apple-xs text-apple-text-tertiary">
                          Last unlock {relTime(d.lastUnlockAt)} · {d.checkInsToday} check-in{d.checkInsToday === 1 ? "" : "s"} today · Kisi lock #{d.kisiLockId}
                          {d.description ? ` · ${d.description}` : ""}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      {canManage ? (
                        <div className="w-full sm:w-56">
                          <Select value={d.locationId ?? ""} onChange={(e) => assign(d, e.target.value)} aria-label="Assign to location">
                            <option value="">— Not assigned —</option>
                            {locations.map((l) => (
                              <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                          </Select>
                        </div>
                      ) : d.location ? (
                        <Link href={adminRoutes.loc.checkIns(d.location.slug)} className="text-apple-sm text-apple-blue hover:underline">
                          {d.location.name}
                        </Link>
                      ) : (
                        <span className="text-apple-sm text-apple-text-tertiary">Not assigned</span>
                      )}
                      {canManage && (
                        <Button variant="ghost" size="sm" onClick={() => toggleHidden(d)}>
                          {d.hidden ? "Unhide" : "Hide"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={d.lockedDown ? "danger" : "primary"}
                        disabled={!kisiConfigured || !canUnlock || d.lockedDown === true}
                        loading={unlocking === d.id}
                        onClick={() => setConfirm(d)}
                        iconLeft={<LockOpen className="h-3.5 w-3.5" />}
                      >
                        Unlock
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      )}

      <Modal open={!!confirm} onClose={() => (unlocking ? null : setConfirm(null))} title={confirm ? `Unlock ${confirm.name}?` : ""}>
        {confirm && (
          <div className="space-y-4">
            <p className="text-apple-sm text-apple-text-secondary">
              This sends a remote unlock to Kisi for <strong>{confirm.name}</strong>
              {confirm.location ? ` at ${confirm.location.name}` : ""}. The door will relock on its normal timer. This action is logged.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)} disabled={!!unlocking}>Cancel</Button>
              <Button onClick={() => unlock(confirm)} loading={unlocking === confirm.id} iconLeft={<LockOpen className="h-4 w-4" />}>
                Unlock door
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function StatusBadges({ d }: { d: DoorRow }) {
  return (
    <>
      {d.online === true && <Badge tone="success" size="sm">Online</Badge>}
      {d.online === false && <Badge tone="danger" size="sm">Offline</Badge>}
      {d.online == null && <Badge tone="muted" size="sm">Status unknown</Badge>}
      {d.lockedDown && <Badge tone="danger" size="sm">Locked down</Badge>}
      {!d.lockedDown && d.unlocked && <Badge tone="info" size="sm">Unlocked</Badge>}
      {d.open === true && <Badge tone="warn" size="sm">Door open</Badge>}
      {d.configured === false && <Badge tone="warn" size="sm">Not configured</Badge>}
      {d.hidden && <Badge tone="muted" size="sm">Hidden</Badge>}
    </>
  );
}
