// app/admin/locations/[slug]/scheduling/bays/page.tsx
"use client";

import Link from "next/link";
import React from "react";
import { useParams } from "next/navigation";
import { Copy, ExternalLink, MonitorSmartphone, Pencil, Plus, QrCode, RefreshCw, Trash2 } from "lucide-react";
import { Badge, Button, Card, Drawer, EmptyState, Input, Modal, PageHeader, Select, Textarea, useToast } from "@/components/ui";
import { Toggle } from "@/components/admin/location-settings/SettingsSection";
import { adminRoutes } from "@/lib/admin/routes";
import { LAUNCH_MONITOR_LABELS, type AdminBayRow, type BayKind, type LaunchMonitor } from "@/types/bay";

type LocationLite = { id: string; name: string; slug: string };

type BayForm = {
  number: string;
  name: string;
  kind: BayKind;
  handedness: "RH" | "LH";
  capacity: string;
  disabled: boolean;
  launchMonitor: LaunchMonitor;
  setupNotes: string;
};

const EMPTY_FORM: BayForm = {
  number: "",
  name: "",
  kind: "GROUP",
  handedness: "RH",
  capacity: "4",
  disabled: false,
  launchMonitor: "IDRA",
  setupNotes: "",
};

function formFromBay(b: AdminBayRow): BayForm {
  return {
    number: String(b.number),
    name: b.name ?? "",
    kind: b.kind,
    handedness: b.handedness ?? "RH",
    capacity: String(b.capacity),
    disabled: b.disabled,
    launchMonitor: b.launchMonitor ?? "IDRA",
    setupNotes: b.setupNotes ?? "",
  };
}

export default function BaysPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params?.slug ?? "");
  const { toast } = useToast();

  const [location, setLocation] = React.useState<LocationLite | null>(null);
  const [bays, setBays] = React.useState<AdminBayRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const [drawer, setDrawer] = React.useState<{ mode: "create" } | { mode: "edit"; bay: AdminBayRow } | null>(null);
  const [form, setForm] = React.useState<BayForm>(EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = React.useState<AdminBayRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [qr, setQr] = React.useState<{ label: string; url: string } | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_BASE_URL || "";
  const publicOrigin = process.env.NEXT_PUBLIC_BASE_URL || origin;

  const load = React.useCallback(
    async (silent = false) => {
      if (!slug) return;
      if (!silent) setRefreshing(true);
      try {
        const res = await fetch(`/api/admin/locations/${encodeURIComponent(slug)}/bays`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || `Failed to load bays (${res.status})`);
        setLocation(json.location);
        setBays(json.bays ?? []);
        setError(null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load bays");
      } finally {
        setRefreshing(false);
      }
    },
    [slug]
  );

  React.useEffect(() => {
    void load(true);
    const t = setInterval(() => void load(true), 60_000);
    return () => clearInterval(t);
  }, [load]);

  function openCreate() {
    const nextNumber = bays?.length ? Math.max(...bays.map((b) => b.number)) + 1 : 1;
    setForm({ ...EMPTY_FORM, number: String(nextNumber) });
    setFormError(null);
    setDrawer({ mode: "create" });
  }

  function openEdit(bay: AdminBayRow) {
    setForm(formFromBay(bay));
    setFormError(null);
    setDrawer({ mode: "edit", bay });
  }

  function set<K extends keyof BayForm>(k: K, v: BayForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (!drawer) return;
    const number = Number(form.number);
    if (!Number.isInteger(number) || number < 1) return setFormError("Bay number must be a positive whole number.");
    const capacity = Number(form.capacity);
    if (form.kind === "GROUP" && (!Number.isInteger(capacity) || capacity < 1)) return setFormError("Capacity must be at least 1.");

    const payload = {
      number,
      name: form.name.trim() || null,
      kind: form.kind,
      handedness: form.kind === "SINGLE" ? form.handedness : null,
      capacity: form.kind === "SINGLE" ? 1 : capacity,
      disabled: form.disabled,
      launchMonitor: form.launchMonitor,
      setupNotes: form.setupNotes.trim() || null,
    };

    setSaving(true);
    setFormError(null);
    try {
      const url =
        drawer.mode === "create"
          ? `/api/admin/locations/${encodeURIComponent(slug)}/bays`
          : `/api/admin/locations/${encodeURIComponent(slug)}/bays/${encodeURIComponent(drawer.bay.id)}`;
      const res = await fetch(url, {
        method: drawer.mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Save failed (${res.status})`);
      toast({ tone: "success", title: drawer.mode === "create" ? `Bay ${number} added` : `Bay ${number} updated` });
      setDrawer(null);
      await load(true);
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/locations/${encodeURIComponent(slug)}/bays/${encodeURIComponent(confirmDelete.id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Delete failed (${res.status})`);
      toast({ tone: "success", title: `Bay ${confirmDelete.number} removed` });
      setConfirmDelete(null);
      await load(true);
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't remove bay", description: e instanceof Error ? e.message : undefined });
    } finally {
      setDeleting(false);
    }
  }

  async function copy(text: string, what: string) {
    const ok = await copyToClipboard(text);
    toast(ok ? { tone: "success", title: `${what} copied` } : { tone: "error", title: "Copy failed", description: text });
  }

  const bayViewUrl = (b: AdminBayRow) => `${publicOrigin}/bay?id=${encodeURIComponent(b.id)}`;
  const scheduleUrl = `${publicOrigin}/schedule?slug=${encodeURIComponent(slug)}`;

  const online = bays?.filter((b) => b.kiosk.online).length ?? 0;
  const installed = bays?.filter((b) => b.kiosk.registered).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bays"
        description={location ? `Simulator bays at ${location.name}.` : "Simulator bays at this location."}
        meta={
          bays && bays.length > 0 ? (
            <>
              <Badge tone="muted">{bays.length} bays</Badge>
              <Badge tone={online === installed && installed > 0 ? "success" : installed > 0 ? "warn" : "muted"}>
                {online}/{installed} kiosks online
              </Badge>
            </>
          ) : undefined
        }
        actions={
          <>
            <Button variant="secondary" iconLeft={<RefreshCw className="h-4 w-4" />} loading={refreshing} onClick={() => void load()}>
              Refresh
            </Button>
            <Button variant="secondary" iconLeft={<ExternalLink className="h-4 w-4" />} onClick={() => void copy(scheduleUrl, "Schedule link")}>
              Schedule link
            </Button>
            <Button iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>
              Add bay
            </Button>
          </>
        }
      />

      {error && (
        <div className="flex flex-col gap-2 rounded-apple border border-apple-red/30 bg-apple-red/5 p-4 text-apple-sm text-apple-red sm:flex-row sm:items-center">
          <span className="flex-1">{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      {!bays && !error && (
        <div className="grid animate-pulse gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 rounded-apple border border-apple-divider bg-white" />
          ))}
        </div>
      )}

      {bays && bays.length === 0 && (
        <EmptyState
          icon={<MonitorSmartphone className="h-6 w-6" />}
          title="No bays yet"
          description="Add each simulator bay so members can book it and the kiosk can be installed on its computer."
          action={
            <Button iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>
              Add your first bay
            </Button>
          }
        />
      )}

      {bays && bays.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {bays.map((b) => (
            <BayCard
              key={b.id}
              bay={b}
              onEdit={() => openEdit(b)}
              onDelete={() => setConfirmDelete(b)}
              onQr={() => setQr({ label: `Bay ${b.number}${b.name ? ` · ${b.name}` : ""}`, url: bayViewUrl(b) })}
              onCopyLink={() => void copy(bayViewUrl(b), "Bay link")}
            />
          ))}
        </div>
      )}

      <p className="text-apple-xs text-apple-text-tertiary">
        Kiosk settings (unlock window, reminders) live under{" "}
        <Link href={adminRoutes.loc.settings.bayApp(slug)} className="font-medium text-apple-blue hover:underline">
          Location Settings → Bay Kiosk
        </Link>
        .
      </p>

      {/* Create / edit drawer */}
      <Drawer
        open={drawer !== null}
        onClose={() => !saving && setDrawer(null)}
        title={drawer?.mode === "edit" ? `Edit bay ${drawer.bay.number}` : "Add bay"}
        description={drawer?.mode === "edit" ? "Changes apply immediately to booking and the kiosk." : "Bays are numbered as players see them on the floor."}
        width="md"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDrawer(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} loading={saving}>
              {drawer?.mode === "edit" ? "Save changes" : "Add bay"}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Bay number" type="number" inputMode="numeric" min={1} value={form.number} onChange={(e) => set("number", e.target.value)} required />
            <Input label="Name (optional)" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Corner bay" />
          </div>

          <Select label="Bay type" value={form.kind} onChange={(e) => set("kind", e.target.value as BayKind)}>
            <option value="GROUP">Group (multiple players)</option>
            <option value="SINGLE">Single player</option>
          </Select>

          {form.kind === "SINGLE" ? (
            <Select label="Handedness" value={form.handedness} onChange={(e) => set("handedness", e.target.value as "RH" | "LH")} hint="Single-player bays are set up for one side.">
              <option value="RH">Right-handed</option>
              <option value="LH">Left-handed</option>
            </Select>
          ) : (
            <Input label="Capacity (players)" type="number" inputMode="numeric" min={1} max={12} value={form.capacity} onChange={(e) => set("capacity", e.target.value)} />
          )}

          <div className="border-t border-apple-divider pt-5">
            <h3 className="mb-3 text-apple-sm font-semibold text-apple-text">Kiosk & help</h3>
            <div className="space-y-4">
              <Select
                label="Launch monitor"
                value={form.launchMonitor}
                onChange={(e) => set("launchMonitor", e.target.value as LaunchMonitor)}
                hint="Picks which troubleshooting guide the kiosk shows on this bay."
              >
                {(Object.keys(LAUNCH_MONITOR_LABELS) as LaunchMonitor[]).map((k) => (
                  <option key={k} value={k}>{LAUNCH_MONITOR_LABELS[k]}</option>
                ))}
              </Select>
              <Textarea
                label="Bay-specific setup notes (optional)"
                rows={4}
                value={form.setupNotes}
                onChange={(e) => set("setupNotes", e.target.value)}
                placeholder={"e.g. Projector remote is in the drawer under the screen.\nThis bay's launch monitor sits 9 ft behind the hitting mat."}
                hint="Shown in the kiosk's Setup Help for this bay only."
              />
            </div>
          </div>

          <div className="border-t border-apple-divider pt-5">
            <Toggle checked={form.disabled} onChange={(v) => set("disabled", v)} label="Disable bay" hint="Hidden from booking while disabled. Existing reservations are kept." />
          </div>

          {formError && <p className="text-apple-sm text-apple-red">{formError}</p>}
        </div>
      </Drawer>

      {/* Delete confirm */}
      <Modal
        open={confirmDelete !== null}
        onClose={() => !deleting && setConfirmDelete(null)}
        title={confirmDelete ? `Remove bay ${confirmDelete.number}?` : "Remove bay"}
        description="This permanently deletes the bay. It can't be removed while it has future reservations — disable it instead."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>
              Keep bay
            </Button>
            <Button variant="danger" onClick={() => void remove()} loading={deleting} iconLeft={<Trash2 className="h-4 w-4" />}>
              Remove bay
            </Button>
          </div>
        }
      >
        {confirmDelete?.kiosk.registered && (
          <p className="text-apple-sm text-apple-text-secondary">
            A kiosk is installed on this bay&apos;s computer. It will need to be re-registered if you add the bay back.
          </p>
        )}
      </Modal>

      {/* QR */}
      <Modal open={qr !== null} onClose={() => setQr(null)} title={qr ? `QR code · ${qr.label}` : "QR code"} description="Players scan this to see the bay's schedule.">
        {qr && (
          <div className="flex flex-col items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qr.url)}`}
              alt={`QR code for ${qr.label}`}
              width={280}
              height={280}
              className="rounded-apple-sm border border-apple-border bg-white p-3"
            />
            <code className="w-full truncate rounded-apple-sm bg-apple-fill-secondary px-3 py-2 text-center text-apple-xs text-apple-text-secondary">{qr.url}</code>
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <Button variant="secondary" className="flex-1" iconLeft={<Copy className="h-4 w-4" />} onClick={() => void copy(qr.url, "Bay link")}>
                Copy link
              </Button>
              <a href={qr.url} target="_blank" rel="noreferrer" className="flex-1">
                <Button variant="secondary" className="w-full" iconLeft={<ExternalLink className="h-4 w-4" />}>
                  Open
                </Button>
              </a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ───────────────────────────── Bay card ────────────────────────────────── */

function BayCard({
  bay,
  onEdit,
  onDelete,
  onQr,
  onCopyLink,
}: {
  bay: AdminBayRow;
  onEdit: () => void;
  onDelete: () => void;
  onQr: () => void;
  onCopyLink: () => void;
}) {
  const kiosk = bay.kiosk;
  return (
    <Card className={bay.disabled ? "opacity-70" : ""}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-apple-sm bg-apple-blue/10 text-apple-lg font-bold text-apple-blue">{bay.number}</div>
          <div className="min-w-0">
            <div className="truncate text-apple-base font-semibold text-apple-text">{bay.name || `Bay ${bay.number}`}</div>
            <div className="truncate text-apple-xs text-apple-text-secondary">
              {bay.kind === "SINGLE" ? `Single · ${bay.handedness === "LH" ? "Left" : "Right"}-handed` : `Group · up to ${bay.capacity}`}
            </div>
          </div>
        </div>
        {bay.disabled ? (
          <Badge tone="danger" size="sm">Disabled</Badge>
        ) : (
          <Badge tone="success" size="sm">Bookable</Badge>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-apple-xs">
        <Badge tone="muted" size="sm">{LAUNCH_MONITOR_LABELS[bay.launchMonitor]}</Badge>
        {!kiosk.registered ? (
          <Badge tone="muted" size="sm">
            <MonitorSmartphone className="h-3 w-3" /> No kiosk
          </Badge>
        ) : kiosk.online ? (
          <Badge tone="success" size="sm">
            <span className="h-1.5 w-1.5 rounded-full bg-apple-green" /> Kiosk online
          </Badge>
        ) : (
          <Badge tone="warn" size="sm">Kiosk offline{kiosk.lastSeenAt ? ` · ${relTime(kiosk.lastSeenAt)}` : ""}</Badge>
        )}
        {kiosk.hostname && <span className="text-apple-text-tertiary">{kiosk.hostname}</span>}
      </div>

      <div className="mt-4 grid grid-cols-4 gap-1 border-t border-apple-divider pt-3">
        <IconAction label="Edit" onClick={onEdit}><Pencil className="h-4 w-4" /></IconAction>
        <IconAction label="QR" onClick={onQr}><QrCode className="h-4 w-4" /></IconAction>
        <IconAction label="Link" onClick={onCopyLink}><Copy className="h-4 w-4" /></IconAction>
        <IconAction label="Remove" onClick={onDelete} danger><Trash2 className="h-4 w-4" /></IconAction>
      </div>
    </Card>
  );
}

function IconAction({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex h-12 flex-col items-center justify-center gap-0.5 rounded-apple-sm text-[10px] font-medium transition-colors sm:h-11",
        danger ? "text-apple-text-tertiary hover:bg-apple-red/5 hover:text-apple-red" : "text-apple-text-secondary hover:bg-apple-fill-secondary hover:text-apple-text",
      ].join(" ")}
    >
      {children}
      {label}
    </button>
  );
}

/* ───────────────────────────── helpers ─────────────────────────────────── */

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function relTime(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}