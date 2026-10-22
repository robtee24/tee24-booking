"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Check, CheckCheck, Clock, ExternalLink } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, StatusBadge, useToast } from "@/components/ui";

export type InboxItem = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  snoozeUntil: string | null;
  createdAt: string;
};

type Tab = "unread" | "all" | "snoozed";

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function InboxClient({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = React.useState<Tab>("unread");
  const [items, setItems] = React.useState<InboxItem[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [unread, setUnread] = React.useState(initialUnread);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (t: Tab, cursor?: string | null) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ tab: t, take: "50" });
        if (cursor) qs.set("cursor", cursor);
        const res = await fetch(`/api/admin/notifications/inbox?${qs}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        setItems((prev) => (cursor ? [...prev, ...json.items] : json.items));
        setNextCursor(json.nextCursor ?? null);
        setUnread(json.unread ?? 0);
      } catch (e: unknown) {
        toast({ tone: "error", title: "Couldn't load notifications", description: e instanceof Error ? e.message : undefined });
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  React.useEffect(() => {
    void load(tab);
  }, [tab, load]);

  async function act(action: "mark-all-read" | "mark-read" | "snooze", ids?: string[], hours?: number) {
    const key = action + (ids?.[0] ?? "");
    setBusy(key);
    try {
      const res = await fetch("/api/admin/notifications/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids, hours }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setUnread(json.unread ?? 0);
      // Optimistic local update, then refresh server-rendered badge in the shell.
      const now = new Date().toISOString();
      setItems((prev) =>
        prev
          .map((n) => {
            if (action === "mark-all-read" || ids?.includes(n.id)) {
              if (action === "snooze") return { ...n, snoozeUntil: new Date(Date.now() + (hours ?? 24) * 3600_000).toISOString() };
              return { ...n, readAt: n.readAt ?? now, snoozeUntil: null };
            }
            return n;
          })
          .filter((n) => (tab === "unread" ? !n.readAt && (!n.snoozeUntil || new Date(n.snoozeUntil) <= new Date()) : tab === "snoozed" ? !n.readAt && !!n.snoozeUntil : true)),
      );
      router.refresh();
    } catch (e: unknown) {
      toast({ tone: "error", title: "Action failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  function onOpen(n: InboxItem) {
    if (!n.readAt) void act("mark-read", [n.id]);
  }

  return (
    <Card padded={false}>
      <CardHeader
        title="Inbox"
        subtitle={unread > 0 ? `${unread} unread` : "You're all caught up"}
        className="p-5"
        action={
          <Button variant="secondary" size="sm" iconLeft={<CheckCheck className="h-4 w-4" />} onClick={() => void act("mark-all-read")} disabled={unread === 0} loading={busy === "mark-all-read"}>
            Mark all read
          </Button>
        }
      />
      <div className="px-5">
        <div role="tablist" aria-label="Inbox filters" className="flex flex-wrap items-center gap-1 border-b border-apple-divider">
          {(
            [
              { value: "unread", label: "Unread", count: unread },
              { value: "all", label: "All" },
              { value: "snoozed", label: "Snoozed" },
            ] as { value: Tab; label: string; count?: number }[]
          ).map((t) => {
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.value)}
                className={[
                  "relative inline-flex items-center gap-1.5 rounded-t-apple-sm px-3 py-2.5 text-apple-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/30",
                  active
                    ? "text-apple-text after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-apple-blue after:content-['']"
                    : "text-apple-text-secondary hover:text-apple-text",
                ].join(" ")}
              >
                {t.label}
                {t.count != null && t.count > 0 && (
                  <span className="rounded-full bg-apple-fill-secondary px-1.5 py-0.5 text-[10px] font-medium text-apple-text-secondary">{t.count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="space-y-2 p-5">
          {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-apple-sm bg-apple-fill-secondary" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={tab === "snoozed" ? <BellOff className="h-6 w-6" /> : <Bell className="h-6 w-6" />}
          title={tab === "unread" ? "Inbox zero" : tab === "snoozed" ? "Nothing snoozed" : "No notifications yet"}
          description={tab === "unread" ? "New alerts will show up here." : undefined}
        />
      ) : (
        <ul className="divide-y divide-apple-divider">
          {items.map((n) => {
            const isUnread = !n.readAt;
            const snoozed = !!n.snoozeUntil && new Date(n.snoozeUntil) > new Date();
            return (
              <li key={n.id} className={`group p-4 transition-colors ${isUnread && !snoozed ? "bg-apple-blue/5" : ""}`}>
                <div className="flex items-start gap-3">
                  <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${isUnread && !snoozed ? "bg-apple-blue" : "bg-transparent"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {n.link ? (
                        <Link href={n.link} onClick={() => onOpen(n)} className={`text-apple-sm ${isUnread ? "font-semibold" : "font-medium"} text-apple-text hover:text-apple-blue`}>
                          {n.title}
                        </Link>
                      ) : (
                        <button type="button" onClick={() => onOpen(n)} className={`text-left text-apple-sm ${isUnread ? "font-semibold" : "font-medium"} text-apple-text`}>
                          {n.title}
                        </button>
                      )}
                      <StatusBadge status={n.severity} size="sm" />
                      {snoozed && (
                        <Badge tone="muted" size="sm">
                          <Clock className="mr-1 h-3 w-3" /> until {new Date(n.snoozeUntil!).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" })}
                        </Badge>
                      )}
                    </div>
                    {n.body && <p className="mt-1 text-apple-sm text-apple-text-secondary">{n.body}</p>}
                    <div className="mt-1 text-apple-xs text-apple-text-tertiary">
                      <span className="font-mono">{n.kind}</span> · {relTime(n.createdAt)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-70 group-hover:opacity-100">
                    {n.link && (
                      <Link href={n.link} onClick={() => onOpen(n)} className="rounded-apple-sm p-1.5 text-apple-text-tertiary hover:bg-apple-fill-secondary hover:text-apple-blue" title="Open" aria-label="Open">
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    )}
                    {isUnread && (
                      <>
                        <button type="button" onClick={() => void act("snooze", [n.id], 24)} className="rounded-apple-sm p-1.5 text-apple-text-tertiary hover:bg-apple-fill-secondary hover:text-apple-text" title="Snooze 1 day" aria-label="Snooze 1 day" disabled={busy === "snooze" + n.id}>
                          <Clock className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => void act("mark-read", [n.id])} className="rounded-apple-sm p-1.5 text-apple-text-tertiary hover:bg-apple-fill-secondary hover:text-apple-green" title="Mark read" aria-label="Mark read" disabled={busy === "mark-read" + n.id}>
                          <Check className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {nextCursor && (
        <div className="border-t border-apple-divider p-3 text-center">
          <Button variant="ghost" size="sm" onClick={() => void load(tab, nextCursor)} loading={loading}>
            Load more
          </Button>
        </div>
      )}
    </Card>
  );
}
