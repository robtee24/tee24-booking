"use client";

import Link from "next/link";
import React from "react";
import { useParams } from "next/navigation";
import { Download, MonitorSmartphone, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { BayKioskSettings } from "@/components/admin/location-settings/BayKioskSettings";
import { SettingsPageState } from "@/components/admin/location-settings/SettingsPageState";
import { useLocationSettings } from "@/components/admin/location-settings/useLocationSettings";
import { adminRoutes } from "@/lib/admin/routes";
import { KIOSK_APP_NAME, KIOSK_DOWNLOAD_URL } from "@/lib/kiosk/download";
import { LAUNCH_MONITOR_LABELS, type AdminBayRow } from "@/types/bay";

export default function BayKioskSettingsPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params?.slug ?? "");
  const { data, loading, error, saving, save, reload } = useLocationSettings(slug);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bay kiosk"
        description="The desktop app that runs on every bay computer: launches GSPro, shows setup help, and unlocks bays for reservations."
        actions={
          <a href={KIOSK_DOWNLOAD_URL} target="_blank" rel="noreferrer">
            <Button iconLeft={<Download className="h-4 w-4" />}>Download installer</Button>
          </a>
        }
      />

      <SettingsPageState loading={loading} error={error} onRetry={reload}>
        {data && <BayKioskSettings data={data} saving={saving} save={save} />}
      </SettingsPageState>

      <Devices slug={slug} />

      <Card>
        <CardHeader title="Installing on a bay computer" subtitle={`${KIOSK_APP_NAME} replaces the Golfin Launcher as the first screen players see.`} />
        <ol className="mt-4 space-y-3 text-apple-sm text-apple-text">
          {[
            <>Download and run the installer on the bay PC. It installs for all users and starts automatically at login.</>,
            <>On first launch, sign in with your admin phone number and pick this location and the bay number.</>,
            <>Point the kiosk at the launch monitor software and GSPro executables (it pre-fills the default Golfin paths).</>,
            <>Remove the Golfin Launcher from Windows startup so the Tee24 kiosk is the only app that opens on boot.</>,
            <>Confirm the bay shows as <strong>Online</strong> in the devices list above.</>,
          ].map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-apple-blue text-[11px] font-bold text-white">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-apple-xs text-apple-text-tertiary">
          Staff can open the kiosk&apos;s hidden setup screen any time with <kbd className="rounded border border-apple-border bg-apple-fill-secondary px-1">Ctrl</kbd>+
          <kbd className="rounded border border-apple-border bg-apple-fill-secondary px-1">Shift</kbd>+
          <kbd className="rounded border border-apple-border bg-apple-fill-secondary px-1">T</kbd>.
        </p>
      </Card>
    </div>
  );
}

/* ───────────────────────────── Registered devices ──────────────────────── */

function Devices({ slug }: { slug: string }) {
  const [rows, setRows] = React.useState<AdminBayRow[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/locations/${encodeURIComponent(slug)}/bays`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load bays (${res.status})`);
      const json = await res.json();
      setRows((json?.bays ?? json ?? []) as AdminBayRow[]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load bays");
    } finally {
      setBusy(false);
    }
  }, [slug]);

  React.useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const registered = rows?.filter((r) => r.kiosk.registered) ?? [];
  const online = registered.filter((r) => r.kiosk.online).length;

  return (
    <Card>
      <CardHeader
        title="Bay computers"
        subtitle={rows ? `${registered.length} of ${rows.length} bays have the kiosk installed · ${online} online now` : "Devices registered to this location."}
        action={
          <Button variant="secondary" size="sm" onClick={() => void load()} loading={busy} iconLeft={<RefreshCw className="h-3.5 w-3.5" />}>
            Refresh
          </Button>
        }
      />

      {err && <p className="mt-3 text-apple-sm text-apple-red">{err}</p>}

      {rows && rows.length === 0 && (
        <p className="mt-3 text-apple-sm text-apple-text-tertiary">
          No bays yet.{" "}
          <Link href={adminRoutes.loc.scheduling.bays(slug)} className="font-medium text-apple-blue hover:underline">
            Add bays
          </Link>{" "}
          first, then install the kiosk on each computer.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="mt-4 divide-y divide-apple-divider rounded-apple-sm border border-apple-border">
          {rows.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-apple-sm">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-apple-sm bg-apple-fill-secondary text-apple-text-tertiary">
                <MonitorSmartphone className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-apple-text">
                  Bay {b.number}
                  {b.name ? ` · ${b.name}` : ""}
                </span>
                <span className="block truncate text-apple-xs text-apple-text-tertiary">
                  {LAUNCH_MONITOR_LABELS[b.launchMonitor]}
                  {b.kiosk.hostname ? ` · ${b.kiosk.hostname}` : ""}
                  {b.kiosk.appVersion ? ` · v${b.kiosk.appVersion}` : ""}
                  {b.kiosk.lastSeenAt ? ` · seen ${relTime(b.kiosk.lastSeenAt)}` : ""}
                </span>
              </span>
              {!b.kiosk.registered ? (
                <Badge tone="muted" size="sm">Not installed</Badge>
              ) : b.kiosk.online ? (
                <Badge tone="success" size="sm">Online</Badge>
              ) : (
                <Badge tone="warn" size="sm">Offline</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}
