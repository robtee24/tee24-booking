"use client";

import React from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Mail, MessageSquare, Search } from "lucide-react";
import { Badge, Button, Card, Input, Select, StatusBadge } from "@/components/ui";
import { adminRoutes } from "@/lib/admin/routes";
import { fmtDate, useErrorToast } from "./shared";
import { stripHtml, useInboxApi, type InboxLocation, type InboxScope } from "./InboxClient";

type Row = {
  id: string;
  createdAt: string;
  channel: string;
  direction: string;
  status: string;
  category: string;
  source: string | null;
  subject: string | null;
  preview: string;
  toAddress: string | null;
  fromAddress: string | null;
  providerError: string | null;
  conversationId: string | null;
  sentByAdminName: string | null;
  automation: boolean;
  member: { id: string; firstName: string; lastName: string; email: string; phone: string | null; locationSlug: string | null } | null;
  lead: { id: string; name: string | null; stage: string } | null;
  location: { id: string; slug: string; name: string } | null;
};

type Full = Row & { body: string };

const SOURCE_LABELS: Record<string, string> = {
  "booking.confirmation": "Booking confirmation",
  "booking.updated": "Booking updated",
  "booking.reminder": "Booking reminder",
  "billing.receipt": "Receipt",
  "billing.pay-link": "Payment link",
  "billing.year-end-summary": "Year-end summary",
  "document.request": "Document request",
  "pos.receipt": "POS receipt",
  "pos.gift-card": "Gift card",
  "daypass.purchase": "Day pass",
  "member.invite": "Member invite",
  "inbound.email": "Inbound email",
  "inbound.sms": "Inbound text",
  "website.contact": "Website form",
};
const sourceLabel = (s: string | null) => (s ? SOURCE_LABELS[s] ?? s : "");

export function MessageLogClient({ scope, locations }: { scope: InboxScope; locations: InboxLocation[] }) {
  const api = useInboxApi(scope);
  const onError = useErrorToast();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [sources, setSources] = React.useState<string[]>([]);
  const [nextBefore, setNextBefore] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [f, setF] = React.useState({ channel: "", direction: "", status: "", category: "", source: "", locationId: "", search: "", from: "", to: "" });
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [full, setFull] = React.useState<Record<string, Full>>({});

  const query = React.useCallback(
    (before?: string | null) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
      if (before) q.set("before", before);
      q.set("take", "100");
      q.set("withSources", "1");
      return `/api/admin/inbox/messages?${q.toString()}`;
    },
    [f],
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ items: Row[]; nextBefore: string | null; sources?: string[] }>(query());
      setRows(res.items);
      setNextBefore(res.nextBefore);
      if (res.sources) setSources(res.sources);
    } catch (e) {
      onError(e);
    } finally {
      setLoading(false);
    }
  }, [api, query, onError]);

  React.useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function more() {
    if (!nextBefore) return;
    try {
      const res = await api<{ items: Row[]; nextBefore: string | null }>(query(nextBefore));
      setRows((cur) => [...cur, ...res.items]);
      setNextBefore(res.nextBefore);
    } catch (e) {
      onError(e);
    }
  }

  async function toggle(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (!full[id]) {
      try {
        const res = await api<{ message: Full }>(`/api/admin/inbox/messages/${id}`);
        setFull((cur) => ({ ...cur, [id]: res.message }));
      } catch (e) {
        onError(e);
      }
    }
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="space-y-3">
      <Card padded={false}>
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-center">
          <Select value={f.channel} onChange={set("channel")} aria-label="Channel">
            <option value="">Email + SMS</option>
            <option value="EMAIL">Email</option>
            <option value="SMS">SMS</option>
          </Select>
          <Select value={f.direction} onChange={set("direction")} aria-label="Direction">
            <option value="">In + out</option>
            <option value="INBOUND">Received</option>
            <option value="OUTBOUND">Sent</option>
          </Select>
          <Select value={f.status} onChange={set("status")} aria-label="Status">
            <option value="">Any status</option>
            {["SENT", "DELIVERED", "OPENED", "CLICKED", "FAILED", "BOUNCED", "QUEUED", "UNSUBSCRIBED"].map((s) => (
              <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
            ))}
          </Select>
          <Select value={f.category} onChange={set("category")} aria-label="Category">
            <option value="">Any category</option>
            <option value="TRANSACTIONAL">Transactional</option>
            <option value="MARKETING">Marketing</option>
            <option value="SYSTEM">System</option>
          </Select>
          <Select value={f.source} onChange={set("source")} aria-label="Source">
            <option value="">Any source</option>
            {sources.map((s) => (
              <option key={s} value={s}>{sourceLabel(s)}</option>
            ))}
          </Select>
          {scope.kind === "org" && locations.length > 1 && (
            <Select value={f.locationId} onChange={set("locationId")} aria-label="Location">
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          )}
          <Input type="date" value={f.from} onChange={set("from")} aria-label="From date" />
          <Input type="date" value={f.to} onChange={set("to")} aria-label="To date" />
          <div className="col-span-2 min-w-[200px] sm:col-span-3 lg:col-auto lg:flex-1">
            <Input placeholder="Search subject, body, address, member…" value={f.search} onChange={set("search")} />
          </div>
        </div>
      </Card>

      <Card padded={false}>
        {loading && rows.length === 0 ? (
          <p className="p-6 text-center text-apple-sm text-apple-text-tertiary">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-apple-text-tertiary">
            <Search className="h-6 w-6" />
            <p className="text-apple-sm">No messages match.</p>
          </div>
        ) : (
          <ul className="divide-y divide-apple-divider">
            {rows.map((m) => {
              const inbound = m.direction === "INBOUND";
              const open = openId === m.id;
              const detail = full[m.id];
              const who = m.member ? `${m.member.firstName} ${m.member.lastName}`.trim() : m.lead?.name || (inbound ? m.fromAddress : m.toAddress);
              const memberHref = m.member && (m.member.locationSlug ?? m.location?.slug) ? adminRoutes.loc.members.detail((m.member.locationSlug ?? m.location?.slug) as string, m.member.id) : null;
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => void toggle(m.id)} className={`grid w-full grid-cols-[auto_1fr_auto] items-start gap-3 p-3 text-left hover:bg-apple-fill-secondary/50 ${open ? "bg-apple-blue/5" : ""}`}>
                    <span className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full ${inbound ? "bg-apple-green/10 text-apple-green" : "bg-apple-blue/10 text-apple-blue"}`} title={inbound ? "Received" : "Sent"}>
                      {m.channel === "SMS" ? <MessageSquare className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="truncate text-apple-sm font-medium text-apple-text">{who || "—"}</span>
                        {inbound ? <ArrowDownLeft className="h-3 w-3 text-apple-green" /> : <ArrowUpRight className="h-3 w-3 text-apple-blue" />}
                        <Badge tone={m.member ? "success" : m.lead?.stage === "SPAM" ? "danger" : "warn"} size="sm">{m.member ? "member" : m.lead ? (m.lead.stage === "SPAM" ? "spam" : m.lead.stage === "ARCHIVED" ? "archived lead" : "lead") : "guest"}</Badge>
                        {scope.kind === "org" && m.location && <Badge tone="muted" size="sm">{m.location.name}</Badge>}
                        {m.source && <Badge tone="default" size="sm">{sourceLabel(m.source)}</Badge>}
                        {m.category === "MARKETING" && <Badge tone="info" size="sm">marketing</Badge>}
                      </span>
                      <span className="block truncate text-apple-sm text-apple-text-secondary">{m.subject ? <span className="font-medium text-apple-text">{m.subject} — </span> : null}{m.preview || "—"}</span>
                      <span className="block truncate text-apple-xs text-apple-text-tertiary">
                        {inbound ? `from ${m.fromAddress ?? "?"}` : `to ${m.toAddress ?? "?"}`}
                        {!inbound ? ` · ${m.sentByAdminName ?? (m.automation ? "Automation" : "System")}` : ""}
                        {m.providerError ? <span className="text-apple-red"> · {m.providerError}</span> : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-apple-xs text-apple-text-tertiary">{fmtDate(m.createdAt)}</span>
                      <StatusBadge status={m.status} size="sm" />
                    </span>
                  </button>
                  {open && (
                    <div className="space-y-2 border-t border-apple-divider bg-apple-fill-secondary/30 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-3 text-apple-xs">
                        {memberHref && <Link href={memberHref} className="font-medium text-apple-blue hover:underline">Open member →</Link>}
                        {m.lead && (m.location?.slug || scope.kind === "location") && (
                          <Link href={`${adminRoutes.loc.marketing.visitors(m.location?.slug ?? (scope as { slug: string }).slug)}?lead=${m.lead.id}`} className="font-medium text-apple-blue hover:underline">Open lead →</Link>
                        )}
                        {m.conversationId && (
                          <Link href={`${scope.kind === "location" ? adminRoutes.loc.marketing.inbox(scope.slug) : adminRoutes.inbox()}?c=${m.conversationId}`} className="font-medium text-apple-blue hover:underline">Open conversation →</Link>
                        )}
                        <span className="text-apple-text-tertiary">{m.channel} · {m.category.toLowerCase()} · {m.status.toLowerCase()}</span>
                      </div>
                      {!detail ? (
                        <p className="text-apple-xs text-apple-text-tertiary">Loading…</p>
                      ) : m.channel === "EMAIL" && /<[a-z][\s\S]*>/i.test(detail.body) ? (
                        <EmailPreview html={detail.body} />
                      ) : (
                        <pre className="whitespace-pre-wrap break-words rounded-apple-sm bg-white p-3 font-sans text-apple-sm text-apple-text shadow-apple-sm">{detail.body}</pre>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {nextBefore && (
          <div className="border-t border-apple-divider p-3 text-center">
            <Button size="sm" variant="secondary" onClick={() => void more()}>Load older</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Sandboxed email render (no scripts, no top navigation). Falls back to text. */
function EmailPreview({ html }: { html: string }) {
  const [raw, setRaw] = React.useState(false);
  return (
    <div className="space-y-1">
      <div className="text-right">
        <button type="button" onClick={() => setRaw(!raw)} className="text-apple-xs text-apple-blue hover:underline">{raw ? "Show rendered" : "Show as text"}</button>
      </div>
      {raw ? (
        <pre className="whitespace-pre-wrap break-words rounded-apple-sm bg-white p-3 font-sans text-apple-sm text-apple-text shadow-apple-sm">{stripHtml(html)}</pre>
      ) : (
        <iframe title="Email" sandbox="" srcDoc={html} className="h-[420px] w-full rounded-apple-sm bg-white shadow-apple-sm" />
      )}
    </div>
  );
}
