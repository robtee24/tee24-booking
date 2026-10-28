"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Monitor, MonitorSmartphone, RefreshCw, TerminalSquare } from "lucide-react";
import { Badge, Button, Card, CardHeader, useToast } from "@/components/ui";
import { LAUNCH_MONITOR_LABELS, type AdminBayRow } from "@/types/bay";

type RemoteState = { configured: boolean; serverUrl: string | null; agentDownloadReady: boolean; singleSignOn: boolean };

export function TroubleshootBays({ slug, bays, remote }: { slug: string; bays: AdminBayRow[]; remote: RemoteState }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);

  // Keep online status fresh while the page is open.
  React.useEffect(() => {
    const t = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(t);
  }, [router]);

  async function openSession(bay: AdminBayRow, view: "desktop" | "terminal" | "files") {
    setBusy(`${bay.id}:${view}`);
    // Open the tab synchronously so popup blockers allow it, then navigate it.
    const tab = window.open("about:blank", "_blank");
    try {
      const res = await fetch(`/api/admin/locations/${encodeURIComponent(slug)}/bays/${encodeURIComponent(bay.id)}/remote?view=${view}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.url) throw new Error(json?.error || `Failed (${res.status})`);
      if (tab) tab.location.href = json.url;
      else window.open(json.url, "_blank");
    } catch (e: unknown) {
      tab?.close();
      toast({ tone: "error", title: `Can't open bay ${bay.number}`, description: e instanceof Error ? e.message : undefined, durationMs: 7000 });
    } finally {
      setBusy(null);
    }
  }

  const online = bays.filter((b) => b.kiosk.online).length;
  const withAgent = bays.filter((b) => b.kiosk.remoteNodeId).length;

  return (
    <Card>
      <CardHeader
        title="Bay computers"
        subtitle={
          bays.length
            ? `${online}/${bays.length} kiosks online · ${withAgent}/${bays.length} ready for remote access${remote.configured ? " · Remote in opens a new tab — click Connect there to start the screen" : " · remote support not configured"}`
            : "No bays yet."
        }
        action={
          <Button variant="secondary" size="sm" iconLeft={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => router.refresh()}>
            Refresh
          </Button>
        }
      />

      {bays.length > 0 && (
        <ul className="mt-4 divide-y divide-apple-divider rounded-apple-sm border border-apple-border">
          {bays.map((b) => {
            const k = b.kiosk;
            const canRemote = remote.configured && !!k.remoteNodeId;
            return (
              <li key={b.id} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-apple-sm bg-apple-blue/10 text-apple-base font-bold text-apple-blue">{b.number}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-apple-sm font-semibold text-apple-text">{b.name || `Bay ${b.number}`}</span>
                      {!k.registered ? (
                        <Badge tone="muted" size="sm">No kiosk</Badge>
                      ) : k.online ? (
                        <Badge tone="success" size="sm">Online</Badge>
                      ) : (
                        <Badge tone="warn" size="sm">Offline{k.lastSeenAt ? ` · ${rel(k.lastSeenAt)}` : ""}</Badge>
                      )}
                      {k.registered && (k.remoteNodeId ? <Badge tone="info" size="sm">Remote ready</Badge> : <Badge tone="muted" size="sm">No remote agent</Badge>)}
                    </div>
                    <div className="truncate text-apple-xs text-apple-text-tertiary">
                      {LAUNCH_MONITOR_LABELS[b.launchMonitor]}
                      {k.hostname ? ` · ${k.hostname}` : ""}
                      {k.appVersion ? ` · kiosk v${k.appVersion}` : ""}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <Button size="sm" disabled={!canRemote} loading={busy === `${b.id}:desktop`} iconLeft={<Monitor className="h-3.5 w-3.5" />} onClick={() => void openSession(b, "desktop")} title={canRemote ? "Open remote desktop (then click Connect in the new tab)" : "Remote agent not reporting yet"}>
                    Remote in
                  </Button>
                  <Button size="sm" variant="secondary" disabled={!canRemote} loading={busy === `${b.id}:terminal`} iconLeft={<TerminalSquare className="h-3.5 w-3.5" />} onClick={() => void openSession(b, "terminal")} title="Open terminal">
                    <span className="sr-only">Terminal</span>
                  </Button>
                  <Button size="sm" variant="secondary" disabled={!canRemote} loading={busy === `${b.id}:files`} iconLeft={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => void openSession(b, "files")} title="Browse files">
                    <span className="sr-only">Files</span>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {bays.length > 0 && bays.every((b) => !b.kiosk.registered) && (
        <p className="mt-3 flex items-center gap-2 text-apple-sm text-apple-text-tertiary">
          <MonitorSmartphone className="h-4 w-4" /> Install the Tee24 Bay Kiosk on each bay PC to see it here.
        </p>
      )}
    </Card>
  );
}

function rel(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
