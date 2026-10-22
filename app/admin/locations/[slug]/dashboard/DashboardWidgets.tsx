"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCircle2, ChevronRight, ListTodo, X } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, useToast } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { readTasksWindow, TASKS_WINDOW_KEY, TASKS_WINDOW_OPTIONS, type TasksWindow } from "@/components/admin/staff/MyAccountCard";

/* ───────────────────────────── Attention list ─────────────────────────── */

export type AttentionDTO = {
  key: string;
  kind: string;
  severity: "ERROR" | "WARN" | "INFO";
  title: string;
  detail: string;
  memberId: string;
  memberName: string;
  href: string;
};

const SEV_DOT: Record<AttentionDTO["severity"], string> = { ERROR: "bg-apple-red", WARN: "bg-apple-orange", INFO: "bg-apple-blue" };

export function AttentionList({ slug, items: initial, dismissedCount }: { slug: string; items: AttentionDTO[]; dismissedCount: number }) {
  const { toast } = useToast();
  const [items, setItems] = React.useState(initial);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<string>("all");

  const kinds = React.useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const i of items) m.set(i.kind, { label: i.title, n: (m.get(i.kind)?.n ?? 0) + 1 });
    return [...m.entries()];
  }, [items]);
  const visible = filter === "all" ? items : items.filter((i) => i.kind === filter);

  async function dismiss(keys: string[]) {
    setBusy(keys.length === 1 ? keys[0]! : "all");
    try {
      const res = await fetch("/api/admin/dashboard/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationSlug: slug, alertKeys: keys }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const set = new Set(keys);
      setItems((prev) => prev.filter((i) => !set.has(i.key)));
      if (keys.length > 1) toast({ tone: "success", title: `Dismissed ${keys.length} alerts` });
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't dismiss", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card padded={false}>
      <CardHeader
        title="Needs attention"
        subtitle={items.length === 0 ? "Nothing outstanding" : `${items.length} item${items.length === 1 ? "" : "s"}${dismissedCount ? ` · ${dismissedCount} dismissed` : ""}`}
        className="p-5 pb-3"
        action={
          items.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => void dismiss(visible.map((i) => i.key))} loading={busy === "all"}>
              Dismiss {filter === "all" ? "all" : "these"}
            </Button>
          ) : undefined
        }
      />
      {kinds.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-5 pb-3">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>All · {items.length}</Chip>
          {kinds.map(([k, v]) => (
            <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>{v.label} · {v.n}</Chip>
          ))}
        </div>
      )}
      {visible.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="h-6 w-6 text-apple-green" />} title="All clear" description="Alerts about payments, memberships, documents, and cards show up here." />
      ) : (
        <ul className="max-h-[28rem] divide-y divide-apple-divider overflow-y-auto">
          {visible.map((i) => (
            <li key={i.key} className="group flex items-start gap-3 px-5 py-3 hover:bg-apple-fill-secondary/60">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEV_DOT[i.severity]}`} aria-hidden />
              <Link href={i.href} className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-apple-sm">
                  <span className="font-medium text-apple-text">{i.memberName}</span>
                  <span className="text-apple-text-tertiary">·</span>
                  <span className="text-apple-text-secondary">{i.title}</span>
                </div>
                <div className="truncate text-apple-xs text-apple-text-tertiary">{i.detail}</div>
              </Link>
              <button
                type="button"
                onClick={() => void dismiss([i.key])}
                disabled={busy === i.key}
                className="rounded-apple-sm p-1 text-apple-text-tertiary opacity-0 transition-opacity hover:bg-apple-fill-secondary hover:text-apple-text group-hover:opacity-100 focus:opacity-100"
                aria-label="Dismiss"
                title="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
              <Link href={i.href} className="mt-0.5 text-apple-text-tertiary" aria-label="Open member">
                <ChevronRight className="h-4 w-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-apple-pill border px-2.5 py-1 text-apple-xs font-medium transition-colors ${active ? "border-apple-blue bg-apple-blue/10 text-apple-blue" : "border-apple-border bg-white text-apple-text-secondary hover:bg-apple-fill-secondary"}`}
    >
      {children}
    </button>
  );
}

/* ─────────────────────────────── Tasks ────────────────────────────────── */

type TaskDTO = {
  id: string;
  title: string;
  dueAt: string | null;
  priority: string;
  status: string;
  memberId: string | null;
  mine: boolean;
  overdue: boolean;
  assignee: { name: string | null } | null;
};

export function TasksWidget({ slug }: { slug: string }) {
  const { toast } = useToast();
  const [window, setWindow] = React.useState<TasksWindow>("7d");
  const [tasks, setTasks] = React.useState<TaskDTO[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => setWindow(readTasksWindow()), []);

  const load = React.useCallback(async (w: TasksWindow) => {
    try {
      const res = await fetch(`/api/admin/dashboard/tasks?locationSlug=${encodeURIComponent(slug)}&window=${w}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setTasks(json.tasks);
    } catch {
      setTasks([]);
    }
  }, [slug]);

  React.useEffect(() => {
    void load(window);
  }, [window, load]);

  function changeWindow(w: TasksWindow) {
    setWindow(w);
    try {
      localStorage.setItem(TASKS_WINDOW_KEY, w);
    } catch {}
  }

  async function complete(id: string) {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "DONE" }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTasks((prev) => prev?.filter((t) => t.id !== id) ?? prev);
    } catch (e: unknown) {
      toast({ tone: "error", title: "Couldn't complete task", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card padded={false}>
      <CardHeader
        title="Open tasks"
        subtitle="Assigned to you or unassigned here"
        className="p-5 pb-3"
        action={
          <select value={window} onChange={(e) => changeWindow(e.target.value as TasksWindow)} aria-label="Tasks window" className="input !w-auto !py-1 text-apple-xs">
            {TASKS_WINDOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        }
      />
      {tasks === null ? (
        <div className="space-y-2 p-5 pt-0">{[0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded-apple-sm bg-apple-fill-secondary" />)}</div>
      ) : tasks.length === 0 ? (
        <EmptyState icon={<ListTodo className="h-6 w-6" />} title="No open tasks" description="You're clear for this window." />
      ) : (
        <ul className="divide-y divide-apple-divider">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-5 py-2.5">
              <button
                type="button"
                onClick={() => void complete(t.id)}
                disabled={busy === t.id}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-apple-border text-transparent transition-colors hover:border-apple-green hover:text-apple-green"
                aria-label="Mark done"
                title="Mark done"
              >
                <Check className="h-3 w-3" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-apple-sm text-apple-text">{t.title}</div>
                <div className="flex items-center gap-2 text-apple-xs text-apple-text-tertiary">
                  {t.dueAt && <span className={t.overdue ? "font-medium text-apple-red" : ""}>{t.overdue ? "Overdue · " : "Due "}{new Date(t.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                  {!t.mine && <Badge tone="muted" size="sm">Unassigned</Badge>}
                  {t.priority === "HIGH" || t.priority === "URGENT" ? <Badge tone="danger" size="sm">{t.priority.toLowerCase()}</Badge> : null}
                  {t.memberId && (
                    <Link href={adminRoutes.loc.members.detail(slug, t.memberId)} className="text-apple-blue hover:underline">member</Link>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-apple-divider px-5 py-2.5 text-right">
        <Link href={adminRoutes.tasks()} className="text-apple-xs font-medium text-apple-blue hover:underline">All tasks →</Link>
      </div>
    </Card>
  );
}

/* ──────────────────────────── Notifications ───────────────────────────── */

export type NotifDTO = { id: string; title: string; body: string | null; link: string | null; severity: string; readAt: string | null; createdAt: string };

export function RecentNotifications({ items: initial }: { items: NotifDTO[] }) {
  const router = useRouter();
  const [items, setItems] = React.useState(initial);

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)));
    await fetch(`/api/admin/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }).catch(() => {});
    router.refresh();
  }

  return (
    <Card padded={false}>
      <CardHeader title="Recent notifications" className="p-5 pb-3" action={<Link href={adminRoutes.notifications()} className="text-apple-xs font-medium text-apple-blue hover:underline">Inbox →</Link>} />
      {items.length === 0 ? (
        <EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications yet" />
      ) : (
        <ul className="divide-y divide-apple-divider">
          {items.map((n) => {
            const unread = !n.readAt;
            const inner = (
              <>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.severity === "ERROR" ? "bg-apple-red" : n.severity === "WARN" ? "bg-apple-orange" : unread ? "bg-apple-blue" : "bg-transparent"}`} />
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-apple-sm ${unread ? "font-semibold" : "font-medium"} text-apple-text`}>{n.title}</div>
                  {n.body && <div className="truncate text-apple-xs text-apple-text-secondary">{n.body}</div>}
                  <div className="text-[10px] text-apple-text-tertiary">{new Date(n.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                </div>
              </>
            );
            return (
              <li key={n.id} className={`flex items-start gap-3 px-5 py-2.5 ${unread ? "bg-apple-blue/5" : ""}`}>
                {n.link ? (
                  <Link href={n.link} onClick={() => unread && void markRead(n.id)} className="flex min-w-0 flex-1 items-start gap-3">{inner}</Link>
                ) : (
                  <div className="flex min-w-0 flex-1 items-start gap-3">{inner}</div>
                )}
                {unread && (
                  <button type="button" onClick={() => void markRead(n.id)} className="rounded-apple-sm p-1 text-apple-text-tertiary hover:bg-apple-fill-secondary hover:text-apple-green" aria-label="Mark read" title="Mark read">
                    <Check className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
