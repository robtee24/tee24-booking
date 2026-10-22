"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge, Button, Card, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { CheckCircle2, Inbox as InboxIcon, Mail, MessageSquare, PenSquare, RotateCcw } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { useAdminLocation } from "@/components/admin/LocationContext";
import { MemberSearch, SegmentCounter, fmtDate, useErrorToast, useMarketingApi } from "./shared";

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
};

type Message = { id: string; direction: string; channel: string; subject: string | null; body: string; status: string; createdAt: string; sentById?: string | null };
type Thread = {
  id: string;
  status: string;
  assignedToId: string | null;
  member: { id: string; firstName: string; lastName: string; email: string; phone: string | null } | null;
  visitor: { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null } | null;
  messages: Message[];
};

type Props = { initial: ConversationRow[]; admins: { id: string; name: string | null; phone: string }[]; currentAdminId: string | null };

export function InboxClient({ initial, admins, currentAdminId }: Props) {
  const api = useMarketingApi();
  const onError = useErrorToast();
  const { toast } = useToast();
  const { slug } = useAdminLocation();
  const sp = useSearchParams();
  const [items, setItems] = React.useState<ConversationRow[]>(initial);
  const [filter, setFilter] = React.useState<{ status: string; assigned: string; search: string }>({ status: "OPEN", assigned: "", search: "" });
  const [selectedId, setSelectedId] = React.useState<string | null>(sp.get("c"));
  const [thread, setThread] = React.useState<Thread | null>(null);
  const [reply, setReply] = React.useState({ channel: "SMS", subject: "", body: "" });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [composing, setComposing] = React.useState(false);
  const adminName = (id: string | null) => (id ? admins.find((a) => a.id === id)?.name ?? "Staff" : null);

  const reload = React.useCallback(async () => {
    try {
      const q = new URLSearchParams();
      q.set("status", filter.status || "ALL");
      if (filter.assigned) q.set("assignedToId", filter.assigned);
      if (filter.search) q.set("search", filter.search);
      const res = await api<{ items: ConversationRow[] }>(`/api/admin/conversations?${q.toString()}`);
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
        const res = await api<{ conversation: Thread }>(`/api/admin/conversations/${id}`);
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
      const res = await api<{ ok: boolean; error?: string; deferredUntil?: string }>(`/api/admin/conversations/${selectedId}/reply`, { method: "POST", json: reply });
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
      await api(`/api/admin/conversations/${selectedId}`, { method: "PATCH", json });
      await reload();
      await loadThread(selectedId);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  const unreadTotal = items.reduce((s, c) => s + c.unread, 0);
  const status = thread?.status ?? selected?.status ?? "OPEN";
  const assignedToId = thread?.assignedToId ?? selected?.assignedToId ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Card padded={false} className="flex max-h-[75vh] flex-col">
        <div className="space-y-2 border-b border-apple-divider p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-apple-sm font-semibold text-apple-text">
              {filter.status === "RESOLVED" ? "Closed" : filter.status === "OPEN" ? "Open" : "All"}
              {unreadTotal > 0 && <Badge tone="info" size="sm">{unreadTotal} unread</Badge>}
            </div>
            <Button size="sm" variant="secondary" iconLeft={<PenSquare className="h-4 w-4" />} onClick={() => setComposing(true)}>New</Button>
          </div>
          <div className="flex gap-2">
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
          </div>
          <Input placeholder="Search name, phone, email…" value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} />
        </div>
        <ul className="flex-1 divide-y divide-apple-divider overflow-y-auto">
          {items.length === 0 && <li className="p-6 text-center text-apple-sm text-apple-text-tertiary">Nothing here.</li>}
          {items.map((c) => (
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
                <div className="flex gap-1">
                  <Badge tone={c.memberId ? "success" : c.visitorId ? "warn" : "muted"} size="sm">{c.memberId ? "member" : c.visitorId ? "lead" : "unknown"}</Badge>
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
                    <Link href={adminRoutes.loc.members.detail(slug, thread.member.id)} className="hover:text-apple-blue">{thread.member.firstName} {thread.member.lastName}</Link>
                  ) : thread?.visitor ? (
                    <Link href={`${adminRoutes.loc.marketing.visitors(slug)}?lead=${thread.visitor.id}`} className="hover:text-apple-blue">
                      {`${thread.visitor.firstName ?? ""} ${thread.visitor.lastName ?? ""}`.trim() || thread.visitor.phone || "Lead"} <Badge tone="warn" size="sm">lead</Badge>
                    </Link>
                  ) : (
                    selected?.contactName ?? "Unknown"
                  )}
                </div>
                <div className="truncate text-apple-xs text-apple-text-tertiary">{[contactPhone, contactEmail].filter(Boolean).join(" · ") || selected?.contactAddress}</div>
              </div>
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
                            {out && m.sentById ? ` · ${adminName(m.sentById)}` : ""}
                            {out && m.status !== "SENT" && m.status !== "DELIVERED" ? ` · ${m.status.toLowerCase()}` : ""}
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

function stripHtml(s: string) {
  return s
    .replace(/<!--attachments:[\s\S]*?-->/, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function NewConversationModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const api = useMarketingApi();
  const onError = useErrorToast();
  const { toast } = useToast();
  const [member, setMember] = React.useState<{ id: string; firstName: string; lastName: string } | null>(null);
  const [f, setF] = React.useState({ channel: "SMS", subject: "", body: "" });
  const [busy, setBusy] = React.useState(false);

  async function start() {
    if (!member) return;
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; error?: string; conversationId: string }>("/api/admin/conversations", { method: "POST", json: { memberId: member.id, ...f } });
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
            <span>{member.firstName} {member.lastName}</span>
            <button type="button" className="text-apple-xs text-apple-blue" onClick={() => setMember(null)}>Change</button>
          </div>
        ) : (
          <MemberSearch onPick={(m) => setMember(m)} />
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
