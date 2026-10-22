"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge, Button, Card, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { Archive, Ban, CheckCircle2, Inbox as InboxIcon, Mail, MessageSquare, Pencil, PenSquare, RotateCcw, ListOrdered, MessagesSquare } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { SegmentCounter, fmtDate, useErrorToast } from "./shared";
import { MessageLogClient } from "./MessageLogClient";

export type ConversationRow = {
  id: string;
  subject: string | null;
  status: string;
  lastMessageAt: string;
  memberId: string | null;
  visitorId: string | null;
  contactName: string;
  contactAddress: string | null;
  channel: "EMAIL" | "SMS" | "MIXED" | null;
  unread: number;
  preview: string;
  assignedToId: string | null;
  locationId: string | null;
  locationSlug: string | null;
  locationName: string | null;
};

type Message = { id: string; direction: string; channel: string; subject: string | null; body: string; status: string; createdAt: string; sentByAdminId?: string | null; source?: string | null };
type Thread = {
  id: string;
  status: string;
  assignedToId: string | null;
  member: { id: string; firstName: string; lastName: string; email: string; phone: string | null; location?: { slug: string; name: string } | null } | null;
  visitor: { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; stage: string; locationId: string | null } | null;
  messages: Message[];
};

export type InboxScope = { kind: "org" } | { kind: "location"; locationId: string; slug: string };
export type InboxLocation = { id: string; slug: string; name: string };

type Props = {
  initial: ConversationRow[];
  admins: { id: string; name: string | null; phone: string }[];
  currentAdminId: string | null;
  scope: InboxScope;
  /** Locations the admin can see (used for badges / filters in org scope). */
  locations: InboxLocation[];
};

/** Tiny fetch wrapper for the org-scoped /api/admin/inbox routes. */
export function useInboxApi(scope: InboxScope) {
  return React.useCallback(
    async <T = unknown,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      const url = new URL(path, window.location.origin);
      if (scope.kind === "location" && !url.searchParams.has("locationId")) url.searchParams.set("locationId", scope.locationId);
      const { json, ...rest } = init ?? {};
      const res = await fetch(url.toString(), {
        ...rest,
        cache: "no-store",
        headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
        body: json !== undefined ? JSON.stringify(json) : rest.body,
      });
      const text = await res.text();
      let data: { error?: string } | null = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { error: text };
      }
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      return data as T;
    },
    [scope],
  );
}

export function InboxClient({ initial, admins, currentAdminId, scope, locations }: Props) {
  const sp = useSearchParams();
  const [view, setView] = React.useState<"conversations" | "messages">(sp.get("view") === "messages" ? "messages" : "conversations");

  return (
    <div className="space-y-4">
      <div className="flex rounded-apple-sm border border-apple-border bg-white p-0.5 text-apple-sm w-fit">
        <button type="button" onClick={() => setView("conversations")} className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-medium ${view === "conversations" ? "bg-apple-fill-secondary text-apple-text" : "text-apple-text-tertiary hover:text-apple-text"}`}>
          <MessagesSquare className="h-4 w-4" /> Conversations
        </button>
        <button type="button" onClick={() => setView("messages")} className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-medium ${view === "messages" ? "bg-apple-fill-secondary text-apple-text" : "text-apple-text-tertiary hover:text-apple-text"}`}>
          <ListOrdered className="h-4 w-4" /> All messages
        </button>
      </div>
      {view === "conversations" ? (
        <Conversations initial={initial} admins={admins} currentAdminId={currentAdminId} scope={scope} locations={locations} />
      ) : (
        <MessageLogClient scope={scope} locations={locations} />
      )}
    </div>
  );
}

function Conversations({ initial, admins, currentAdminId, scope, locations }: Props) {
  const api = useInboxApi(scope);
  const onError = useErrorToast();
  const { toast } = useToast();
  const sp = useSearchParams();
  const [items, setItems] = React.useState<ConversationRow[]>(initial);
  const [filter, setFilter] = React.useState<{ status: string; assigned: string; search: string; kind: string }>({ status: "OPEN", assigned: "", search: "", kind: "" });
  const [selectedId, setSelectedId] = React.useState<string | null>(sp.get("c"));
  const [thread, setThread] = React.useState<Thread | null>(null);
  const [reply, setReply] = React.useState({ channel: "SMS", subject: "", body: "" });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [composing, setComposing] = React.useState(false);
  const adminName = (id: string | null) => (id ? admins.find((a) => a.id === id)?.name ?? "Staff" : null);
  const slugFor = (locId: string | null | undefined) => locations.find((l) => l.id === locId)?.slug ?? (scope.kind === "location" ? scope.slug : null);

  const reload = React.useCallback(async () => {
    try {
      const q = new URLSearchParams();
      q.set("status", filter.status || "ALL");
      if (filter.assigned) q.set("assignedToId", filter.assigned);
      if (filter.search) q.set("search", filter.search);
      const res = await api<{ items: ConversationRow[] }>(`/api/admin/inbox/conversations?${q.toString()}`);
      setItems(res.items);
    } catch (e) {
      onError(e);
    }
  }, [api, filter, onError]);

  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(reload, 250);
    return () => clearTimeout(t);
  }, [filter, reload]);

  // Poll for new inbound every 30s.
  React.useEffect(() => {
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [reload]);

  const loadThread = React.useCallback(
    async (id: string) => {
      try {
        const res = await api<{ conversation: Thread }>(`/api/admin/inbox/conversations/${id}`);
        setThread(res.conversation);
        setItems((cur) => cur.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
        const external = res.conversation.messages.filter((m) => m.channel !== "INTERNAL");
        const lastInbound = [...external].reverse().find((m) => m.direction === "INBOUND") ?? external[external.length - 1];
        setReply((r) => ({ ...r, channel: lastInbound?.channel ?? "SMS" }));
      } catch (e) {
        onError(e);
      }
    },
    [api, onError],
  );
  React.useEffect(() => {
    if (selectedId) void loadThread(selectedId);
    else setThread(null);
  }, [selectedId, loadThread]);

  const selected = items.find((c) => c.id === selectedId) ?? null;
  const contact = thread?.member ?? thread?.visitor ?? null;
  const contactPhone = contact?.phone ?? null;
  const contactEmail = contact?.email ?? null;

  async function send() {
    if (!selectedId || !reply.body.trim()) return;
    setBusy("send");
    try {
      const res = await api<{ ok: boolean; error?: string; deferredUntil?: string }>(`/api/admin/inbox/conversations/${selectedId}/reply`, { method: "POST", json: reply });
      if (!res.ok) toast({ tone: "error", title: "Send failed", description: res.error });
      else if (res.deferredUntil) toast({ tone: "info", title: "Queued", description: `Quiet hours — sends ${fmtDate(res.deferredUntil)}` });
      setReply({ ...reply, body: "", subject: "" });
      await loadThread(selectedId);
      await reload();
    } catch (e) {
      onError(e, "Send failed");
    } finally {
      setBusy(null);
    }
  }

  async function patch(json: Record<string, unknown>) {
    if (!selectedId) return;
    setBusy("patch");
    try {
      await api(`/api/admin/inbox/conversations/${selectedId}`, { method: "PATCH", json });
      await reload();
      await loadThread(selectedId);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  async function patchLead(leadId: string, json: Record<string, unknown>, title?: string) {
    setBusy("lead");
    try {
      await api(`/api/admin/inbox/leads/${leadId}`, { method: "PATCH", json });
      if (title) toast({ tone: "success", title });
      await reload();
      if (selectedId) await loadThread(selectedId);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  const visible = items.filter((c) => !filter.kind || (filter.kind === "member" ? !!c.memberId : filter.kind === "lead" ? !c.memberId : true));
  const unreadTotal = items.reduce((s, c) => s + c.unread, 0);
  const status = thread?.status ?? selected?.status ?? "OPEN";
  const assignedToId = thread?.assignedToId ?? selected?.assignedToId ?? null;
  const threadSlug = thread?.member?.location?.slug ?? slugFor(thread?.visitor?.locationId ?? selected?.locationId);

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <Card padded={false} className="flex max-h-[75vh] flex-col">
        <div className="space-y-2 border-b border-apple-divider p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-apple-sm font-semibold text-apple-text">
              {filter.status === "RESOLVED" ? "Closed" : filter.status === "OPEN" ? "Open" : "All"}
              {unreadTotal > 0 && <Badge tone="info" size="sm">{unreadTotal} unread</Badge>}
            </div>
            <Button size="sm" variant="secondary" iconLeft={<PenSquare className="h-4 w-4" />} onClick={() => setComposing(true)}>New</Button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} aria-label="Status">
              <option value="OPEN">Open</option>
              <option value="RESOLVED">Closed</option>
              <option value="ALL">All</option>
            </Select>
            <Select value={filter.assigned} onChange={(e) => setFilter({ ...filter, assigned: e.target.value })} aria-label="Assigned">
              <option value="">Anyone</option>
              {currentAdminId && <option value={currentAdminId}>Mine</option>}
              <option value="unassigned">Unassigned</option>
            </Select>
            <Select value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value })} aria-label="Contact type">
              <option value="">Members + leads</option>
              <option value="member">Members</option>
              <option value="lead">Leads</option>
            </Select>
          </div>
          <Input placeholder="Search name, phone, email…" value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} />
        </div>
        <ul className="flex-1 divide-y divide-apple-divider overflow-y-auto">
          {visible.length === 0 && <li className="p-6 text-center text-apple-sm text-apple-text-tertiary">Nothing here.</li>}
          {visible.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setSelectedId(c.id)} className={`flex w-full flex-col gap-0.5 p-3 text-left hover:bg-apple-fill-secondary/50 ${selectedId === c.id ? "bg-apple-blue/5" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate text-apple-sm ${c.unread ? "font-semibold text-apple-text" : "font-medium text-apple-text-secondary"}`}>{c.contactName}</span>
                  <span className="shrink-0 text-[10px] text-apple-text-tertiary">{fmtDate(c.lastMessageAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </div>
                <div className="flex items-center gap-1.5 text-apple-xs text-apple-text-tertiary">
                  {c.channel === "EMAIL" ? <Mail className="h-3 w-3 shrink-0" /> : <MessageSquare className="h-3 w-3 shrink-0" />}
                  <span className="truncate">{c.preview || c.subject || "—"}</span>
                  {c.unread > 0 && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-apple-blue" />}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge tone={c.memberId ? "success" : c.visitorId ? "warn" : "muted"} size="sm">{c.memberId ? "member" : c.visitorId ? "lead" : "unknown"}</Badge>
                  {scope.kind === "org" && c.locationName && <Badge tone="muted" size="sm">{c.locationName}</Badge>}
                  {c.assignedToId && <Badge tone="default" size="sm">{adminName(c.assignedToId)}</Badge>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card padded={false} className="flex max-h-[75vh] min-h-[420px] flex-col">
        {!selected && !thread ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-apple-text-tertiary">
            <InboxIcon className="h-8 w-8" />
            <p className="text-apple-sm">Select a conversation</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-apple-divider p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-apple-sm font-semibold text-apple-text">
                  {thread?.member ? (
                    threadSlug ? (
                      <Link href={adminRoutes.loc.members.detail(threadSlug, thread.member.id)} className="hover:text-apple-blue">{thread.member.firstName} {thread.member.lastName}</Link>
                    ) : (
                      <>{thread.member.firstName} {thread.member.lastName}</>
                    )
                  ) : thread?.visitor ? (
                    <LeadHeader
                      visitor={thread.visitor}
                      slug={threadSlug}
                      busy={busy === "lead"}
                      onRename={(firstName, lastName) => patchLead(thread.visitor!.id, { firstName, lastName }, "Lead renamed")}
                    />
                  ) : (
                    selected?.contactName ?? "Unknown"
                  )}
                </div>
                <div className="truncate text-apple-xs text-apple-text-tertiary">
                  {[contactPhone, contactEmail].filter(Boolean).join(" · ") || selected?.contactAddress}
                  {scope.kind === "org" && (thread?.member?.location?.name ?? selected?.locationName) ? ` · ${thread?.member?.location?.name ?? selected?.locationName}` : ""}
                </div>
              </div>
              {thread?.visitor && (
                <div className="flex gap-1">
                  {thread.visitor.stage === "SPAM" || thread.visitor.stage === "ARCHIVED" ? (
                    <Button size="sm" variant="secondary" iconLeft={<RotateCcw className="h-4 w-4" />} loading={busy === "lead"} onClick={() => patchLead(thread.visitor!.id, { stage: "NEW" }, "Lead restored")}>Restore lead</Button>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" iconLeft={<Archive className="h-4 w-4" />} loading={busy === "lead"} onClick={() => patchLead(thread.visitor!.id, { stage: "ARCHIVED" }, "Lead archived")}>Archive</Button>
                      <Button size="sm" variant="secondary" iconLeft={<Ban className="h-4 w-4" />} loading={busy === "lead"} onClick={() => patchLead(thread.visitor!.id, { stage: "SPAM" }, "Marked as spam")}><span className="text-apple-red">Spam</span></Button>
                    </>
                  )}
                </div>
              )}
              <Select value={assignedToId ?? ""} onChange={(e) => patch({ assignedToId: e.target.value || null })} aria-label="Assign" disabled={busy === "patch"}>
                <option value="">Unassigned</option>
                {admins.map((a) => (
                  <option key={a.id} value={a.id}>{a.name ?? a.phone}</option>
                ))}
              </Select>
              {status === "RESOLVED" ? (
                <Button size="sm" variant="secondary" iconLeft={<RotateCcw className="h-4 w-4" />} onClick={() => patch({ status: "OPEN" })} loading={busy === "patch"}>Reopen</Button>
              ) : (
                <Button size="sm" variant="secondary" iconLeft={<CheckCircle2 className="h-4 w-4" />} onClick={() => patch({ status: "RESOLVED" })} loading={busy === "patch"}>Close</Button>
              )}
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto bg-apple-fill-secondary/30 p-4">
              {!thread ? (
                <p className="text-center text-apple-xs text-apple-text-tertiary">Loading…</p>
              ) : (
                thread.messages
                  .filter((m) => m.channel !== "INTERNAL")
                  .map((m) => {
                    const out = m.direction === "OUTBOUND";
                    return (
                      <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] rounded-apple px-3 py-2 text-apple-sm shadow-apple-sm ${out ? "bg-apple-blue text-white" : "bg-white text-apple-text"}`}>
                          {m.subject && <div className="mb-1 text-apple-xs font-semibold opacity-80">{m.subject}</div>}
                          <div className="whitespace-pre-wrap break-words">{m.channel === "EMAIL" ? stripHtml(m.body) : m.body}</div>
                          <div className={`mt-1 text-[10px] ${out ? "text-white/70" : "text-apple-text-tertiary"}`}>
                            {m.channel} · {fmtDate(m.createdAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                            {out && m.sentByAdminId ? ` · ${adminName(m.sentByAdminId)}` : ""}
                            {out && m.status !== "SENT" && m.status !== "DELIVERED" ? ` · ${m.status.toLowerCase()}` : ""}
                            {m.source === "website.contact" ? " · website form" : ""}
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
            <div className="space-y-2 border-t border-apple-divider p-3">
              <div className="flex items-center gap-2">
                <Select value={reply.channel} onChange={(e) => setReply({ ...reply, channel: e.target.value })} aria-label="Reply channel">
                  <option value="SMS" disabled={!!thread && !contactPhone}>SMS</option>
                  <option value="EMAIL" disabled={!!thread && !contactEmail}>Email</option>
                </Select>
                {reply.channel === "EMAIL" && <div className="flex-1"><Input placeholder="Subject" value={reply.subject} onChange={(e) => setReply({ ...reply, subject: e.target.value })} /></div>}
              </div>
              <Textarea
                rows={3}
                placeholder={`Reply by ${reply.channel === "SMS" ? "text" : "email"}… (⌘↵ to send)`}
                value={reply.body}
                onChange={(e) => setReply({ ...reply, body: e.target.value })}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void send();
                }}
              />
              <div className="flex items-center justify-between">
                {reply.channel === "SMS" ? <SegmentCounter text={reply.body} /> : <span />}
                <Button size="sm" onClick={send} loading={busy === "send"} disabled={!reply.body.trim()}>Send</Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {composing && (
        <NewConversationModal
          scope={scope}
          onClose={() => setComposing(false)}
          onCreated={(id) => {
            setComposing(false);
            setFilter((f) => ({ ...f, status: "OPEN" }));
            void reload().then(() => setSelectedId(id));
          }}
        />
      )}
    </div>
  );
}

/** Lead name with inline rename. */
function LeadHeader({ visitor, slug, busy, onRename }: { visitor: NonNullable<Thread["visitor"]>; slug: string | null; busy: boolean; onRename: (first: string, last: string) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [first, setFirst] = React.useState(visitor.firstName ?? "");
  const [last, setLast] = React.useState(visitor.lastName ?? "");
  React.useEffect(() => {
    setFirst(visitor.firstName ?? "");
    setLast(visitor.lastName ?? "");
    setEditing(false);
  }, [visitor.id, visitor.firstName, visitor.lastName]);
  const name = `${visitor.firstName ?? ""} ${visitor.lastName ?? ""}`.trim();
  const stageTone = visitor.stage === "SPAM" ? "danger" : visitor.stage === "ARCHIVED" ? "muted" : "warn";

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          onRename(first, last);
          setEditing(false);
        }}
      >
        <input autoFocus value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First name" className="w-32 rounded-apple-sm border border-apple-border px-2 py-1 text-apple-sm font-normal outline-none focus:border-apple-blue" />
        <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last name" className="w-32 rounded-apple-sm border border-apple-border px-2 py-1 text-apple-sm font-normal outline-none focus:border-apple-blue" />
        <Button size="sm" type="submit" loading={busy}>Save</Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>Cancel</Button>
      </form>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {slug ? (
        <Link href={`${adminRoutes.loc.marketing.visitors(slug)}?lead=${visitor.id}`} className="hover:text-apple-blue">{name || visitor.phone || visitor.email || "Lead"}</Link>
      ) : (
        <span>{name || visitor.phone || visitor.email || "Lead"}</span>
      )}
      <Badge tone={stageTone} size="sm">{visitor.stage === "SPAM" ? "spam" : visitor.stage === "ARCHIVED" ? "archived" : "lead"}</Badge>
      <button type="button" onClick={() => setEditing(true)} className="rounded p-0.5 text-apple-text-tertiary hover:text-apple-blue" aria-label={name ? "Edit name" : "Add name"} title={name ? "Edit name" : "Add name"}>
        <Pencil className="h-3.5 w-3.5" />
      </button>
      {!name && <button type="button" onClick={() => setEditing(true)} className="text-apple-xs font-normal text-apple-blue hover:underline">Add name</button>}
    </span>
  );
}

export function stripHtml(s: string) {
  return s
    .replace(/<!--attachments:[\s\S]*?-->/, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function NewConversationModal({ scope, onClose, onCreated }: { scope: InboxScope; onClose: () => void; onCreated: (id: string) => void }) {
  const api = useInboxApi(scope);
  const onError = useErrorToast();
  const { toast } = useToast();
  const [member, setMember] = React.useState<{ id: string; firstName: string; lastName: string; location?: { name: string } | null } | null>(null);
  const [f, setF] = React.useState({ channel: "SMS", subject: "", body: "" });
  const [busy, setBusy] = React.useState(false);

  async function start() {
    if (!member) return;
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; error?: string; conversationId: string }>("/api/admin/inbox/conversations", { method: "POST", json: { memberId: member.id, ...f } });
      if (!res.ok) toast({ tone: "error", title: "Send failed", description: res.error });
      onCreated(res.conversationId);
    } catch (e) {
      onError(e, "Could not send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New message" description="Start a conversation with a member." footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={start} loading={busy} disabled={!member || !f.body.trim()}>Send</Button></div>}>
      <div className="space-y-3">
        {member ? (
          <div className="flex items-center justify-between rounded-apple-sm bg-apple-fill-secondary p-2 text-apple-sm">
            <span>{member.firstName} {member.lastName}{member.location ? <span className="text-apple-text-tertiary"> · {member.location.name}</span> : null}</span>
            <button type="button" className="text-apple-xs text-apple-blue" onClick={() => setMember(null)}>Change</button>
          </div>
        ) : (
          <InboxMemberSearch scope={scope} onPick={(m) => setMember(m)} />
        )}
        <Select label="Channel" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
          <option value="SMS">SMS</option>
          <option value="EMAIL">Email</option>
        </Select>
        {f.channel === "EMAIL" && <Input label="Subject" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}
        <Textarea label="Message" rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        {f.channel === "SMS" && <SegmentCounter text={f.body} />}
      </div>
    </Modal>
  );
}

type SearchHit = { id: string; firstName: string; lastName: string; email: string; phone: string; status: string; location?: { name: string; slug: string } | null };

function InboxMemberSearch({ scope, onPick }: { scope: InboxScope; onPick: (m: SearchHit) => void }) {
  const api = useInboxApi(scope);
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<SearchHit[]>([]);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const j = await api<{ items: SearchHit[] }>(`/api/admin/inbox/member-search?q=${encodeURIComponent(q)}`);
        setResults(j.items ?? []);
        setOpen(true);
      } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [q, api]);
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => results.length && setOpen(true)} placeholder="Search members by name, email or phone…" className="w-full rounded-apple-sm border border-apple-border px-3 py-2 text-apple-sm outline-none focus:border-apple-blue" />
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-apple-sm border border-apple-border bg-white shadow-apple-md">
          {results.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => { onPick(m); setOpen(false); setQ(`${m.firstName} ${m.lastName}`); }} className="flex w-full flex-col px-3 py-2 text-left hover:bg-apple-fill-secondary">
                <span className="text-apple-sm text-apple-text">{m.firstName} {m.lastName} <span className="text-apple-xs text-apple-text-tertiary">· {m.status.toLowerCase()}{m.location ? ` · ${m.location.name}` : ""}</span></span>
                <span className="text-apple-xs text-apple-text-tertiary">{[m.email, m.phone].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
