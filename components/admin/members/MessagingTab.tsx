"use client";

import React from "react";
import Link from "next/link";
import { Mail, MessageSquare, Send } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { Badge, Button, Card, EmptyState, Input, Select, StatusBadge, Textarea, useToast } from "@/components/ui";
import { ErrorBanner, LoadingRows, api, errMsg, fmtDateTime } from "./shared";

type Msg = { id: string; channel: string; direction: string; status: string; category: string; subject: string | null; body: string; toAddress: string | null; fromAddress: string | null; providerError: string | null; createdAt: string; sentByAdminName: string | null; sentByAutomationId: string | null; openedAt: string | null };
type Data = { messages: Msg[]; canEmail: boolean; canSms: boolean };

export function MessagingTab({ slug, memberId }: { slug: string; memberId: string }) {
  const { toast } = useToast();
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [channel, setChannel] = React.useState<"EMAIL" | "SMS">("EMAIL");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [filter, setFilter] = React.useState<"ALL" | "EMAIL" | "SMS">("ALL");
  const [sending, setSending] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(() => {
    setError(null);
    api<Data>(`/api/admin/members/${memberId}/messages`).then((d) => { setData(d); if (!d.canEmail && d.canSms) setChannel("SMS"); }).catch((e) => setError(errMsg(e)));
  }, [memberId]);
  React.useEffect(load, [load]);
  React.useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [data?.messages.length]);

  async function send() {
    if (!body.trim()) return;
    setSending(true);
    try {
      const r = await api<{ ok: boolean; message: Msg }>(`/api/admin/members/${memberId}/messages`, { method: "POST", json: { channel, subject: channel === "EMAIL" ? subject : undefined, body } });
      toast({ tone: r.ok ? "success" : "error", title: r.ok ? "Message sent" : "Message failed", description: r.ok ? undefined : r.message.providerError ?? undefined });
      setBody("");
      setSubject("");
      load();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't send", description: errMsg(e) });
    } finally {
      setSending(false);
    }
  }

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return <LoadingRows n={3} />;

  const visible = data.messages.filter((m) => filter === "ALL" || m.channel === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-apple-lg font-semibold text-apple-text">Messaging</h2>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {(["ALL", "EMAIL", "SMS"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-apple-pill px-3 py-1 text-apple-xs font-medium ${filter === f ? "bg-apple-text text-white" : "bg-apple-fill-secondary text-apple-text-secondary"}`}>{f === "ALL" ? "All" : f === "EMAIL" ? "Email" : "SMS"}</button>
            ))}
          </div>
          <Link href={`${adminRoutes.loc.marketing.compose(slug)}?memberIds=${memberId}`} className="text-apple-xs font-medium text-apple-blue hover:underline">Use a template →</Link>
        </div>
      </div>

      <Card padded={false}>
        <div className="max-h-[32rem] space-y-3 overflow-y-auto p-4">
          {visible.length === 0 ? (
            <EmptyState icon={<MessageSquare className="h-5 w-5" />} title="No messages yet" description="Emails and texts exchanged with this member show up here." />
          ) : (
            visible.map((m) => {
              const out = m.direction === "OUTBOUND";
              return (
                <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-apple px-3 py-2 text-apple-sm sm:max-w-[70%] ${out ? "bg-apple-blue text-white" : "bg-apple-fill-secondary text-apple-text"}`}>
                    <div className={`mb-1 flex flex-wrap items-center gap-1.5 text-[11px] ${out ? "text-white/80" : "text-apple-text-tertiary"}`}>
                      {m.channel === "SMS" ? <MessageSquare className="h-3 w-3" /> : <Mail className="h-3 w-3" />}
                      <span>{m.channel === "SMS" ? "Text" : "Email"}</span>
                      <span>·</span>
                      <span>{fmtDateTime(m.createdAt)}</span>
                      {out && <span>· {m.sentByAdminName ?? (m.sentByAutomationId ? "Automation" : "System")}</span>}
                      {m.category !== "TRANSACTIONAL" && <Badge tone={out ? "default" : "muted"} size="sm">{m.category.toLowerCase()}</Badge>}
                    </div>
                    {m.subject && <div className="font-semibold">{m.subject}</div>}
                    <div className="whitespace-pre-wrap break-words">{stripHtml(m.body)}</div>
                    <div className={`mt-1 flex items-center gap-2 text-[11px] ${out ? "text-white/70" : "text-apple-text-tertiary"}`}>
                      {out && <StatusBadge status={m.status} size="sm" />}
                      {m.openedAt && <span>Opened {fmtDateTime(m.openedAt)}</span>}
                      {m.providerError && <span className="text-apple-red">{m.providerError}</span>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>
        <div className="space-y-2 border-t border-apple-divider p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="sm:w-40">
              <Select value={channel} onChange={(e) => setChannel(e.target.value as never)}>
                <option value="EMAIL" disabled={!data.canEmail}>Email</option>
                <option value="SMS" disabled={!data.canSms}>Text (SMS)</option>
              </Select>
            </div>
            {channel === "EMAIL" && <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />}
          </div>
          <Textarea rows={3} placeholder={channel === "SMS" ? "Type a text message…" : "Write your email…"} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void send(); }} />
          <div className="flex items-center justify-between">
            <span className="text-apple-xs text-apple-text-tertiary">{channel === "SMS" ? `${body.length} chars` : "⌘↵ to send"}</span>
            <Button iconLeft={<Send className="h-4 w-4" />} loading={sending} disabled={!body.trim()} onClick={() => void send()}>Send</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function stripHtml(s: string): string {
  if (!/<[a-z][\s\S]*>/i.test(s)) return s;
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}
