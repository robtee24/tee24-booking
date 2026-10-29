"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, Input, PageHeader, Select, Textarea, useToast } from "@/components/ui";
import { CalendarClock, FlaskConical, Paperclip, Save, Send, X } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { Field, MergeFieldChips, MultiSelectChips, SegmentCounter, useErrorToast, useMarketingApi } from "@/components/admin/marketing/shared";

type Tag = { id: string; name: string };
type Plan = { id: string; name: string; category: string };
type Template = { id: string; name: string; channel: string; category: string; subject: string | null; body: string };

type Props = {
  location: { id: string; name: string; slug: string; organizationId: string | null };
  tags: Tag[];
  plans: Plan[];
  templates: Template[];
  mergeFields: readonly string[];
  admin: { email: string | null; phone: string | null };
  comms: { emailEnabled: boolean; smsEnabled: boolean; pushEnabled?: boolean };
  initialTemplateId?: string | null;
};

type Channel = "EMAIL" | "SMS" | "PUSH";
type ChannelSplit = { push: number; sms: number; unreachable: number };

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active members" },
  { value: "VISITOR", label: "Visitors" },
  { value: "PENDING", label: "Pending" },
  { value: "FROZEN", label: "Frozen" },
  { value: "CANCELLED", label: "Cancelled" },
];

export function ComposeClient({ location, tags, plans, templates, mergeFields, admin, comms, initialTemplateId }: Props) {
  const router = useRouter();
  const api = useMarketingApi();
  const onError = useErrorToast();
  const { toast } = useToast();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const initialTemplate = initialTemplateId ? templates.find((t) => t.id === initialTemplateId) : undefined;

  const [channel, setChannel] = useState<Channel>(initialTemplate ? (initialTemplate.channel as Channel) : comms.emailEnabled || !comms.smsEnabled ? "EMAIL" : "PUSH");
  const [statuses, setStatuses] = useState<string[]>(["ACTIVE"]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [inactiveDays, setInactiveDays] = useState<number | undefined>(undefined);
  const [churnRiskMin, setChurnRiskMin] = useState<number | undefined>(undefined);
  const [templateId, setTemplateId] = useState<string>(initialTemplate?.id ?? "");
  const [subject, setSubject] = useState(initialTemplate?.subject ?? "");
  const [body, setBody] = useState(initialTemplate?.body ?? "");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attachmentDraft, setAttachmentDraft] = useState("");
  const [saveAs, setSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [schedule, setSchedule] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");
  const [audience, setAudienceInfo] = useState<{ size: number; sampleMemberId: string | null; channels?: ChannelSplit } | null>(null);
  const [busy, setBusy] = useState<"send" | "test" | null>(null);

  const audienceFilter = {
    locationId: location.id,
    organizationId: location.organizationId ?? undefined,
    status: statuses,
    tagIds,
    membershipPlanIds: planIds,
    inactiveDays,
    churnRiskMin,
    channel,
  };
  const audienceKey = JSON.stringify(audienceFilter);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await api<{ size: number; sampleMemberId: string | null; channels?: ChannelSplit }>(`/api/admin/marketing/messaging?audience=${encodeURIComponent(audienceKey)}`);
        setAudienceInfo(res);
      } catch {
        /* ignore */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [audienceKey, api]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      if (t.subject) setSubject(t.subject);
      setBody(t.body);
    }
  }

  function addAttachment() {
    const url = attachmentDraft.trim();
    if (!url) return;
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) throw new Error();
    } catch {
      toast({ tone: "error", title: "Enter a full http(s) URL" });
      return;
    }
    setAttachments((a) => Array.from(new Set([...a, url])));
    setAttachmentDraft("");
  }

  const isText = channel !== "EMAIL";
  const canSend = !!body.trim() && (isText || !!subject.trim()) && (!schedule || !!scheduledFor) && (!saveAs || !!saveAsName.trim());
  const channelDisabled = channel === "EMAIL" ? !comms.emailEnabled : channel === "SMS" ? !comms.smsEnabled : !comms.smsEnabled && comms.pushEnabled === false;
  const channelNoun = channel === "EMAIL" ? "email" : channel === "SMS" ? "text" : "notification";

  async function sendTest() {
    setBusy("test");
    try {
      const res = await api<{ ok: boolean; error?: string; dryRun?: boolean; to?: string }>("/api/admin/marketing/messaging/test", {
        method: "POST",
        json: { channel, subject, body, templateId: templateId || undefined, attachmentUrls: channel === "EMAIL" ? attachments : undefined, sampleMemberId: audience?.sampleMemberId ?? null },
      });
      toast({ tone: res.ok ? "success" : "error", title: res.ok ? `Test ${res.dryRun ? "logged (dry run)" : "sent"} to you` : "Test failed", description: res.error ?? res.to ?? (channel === "EMAIL" ? admin.email ?? undefined : admin.phone ?? undefined) });
    } catch (e) {
      onError(e, "Test failed");
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    const size = audience?.size ?? 0;
    const when = schedule && scheduledFor ? ` on ${new Date(scheduledFor).toLocaleString()}` : " now";
    const split = channel === "PUSH" && audience?.channels ? ` (${audience.channels.push} by app push, ${audience.channels.sms} by text)` : "";
    if (!confirm(`${schedule ? "Schedule" : "Send"} this ${channelNoun} to ${size} recipient${size === 1 ? "" : "s"}${split}${when}?`)) return;
    setBusy("send");
    try {
      const res = await api<{ audienceSize: number; sent: number; failed: number; queued: number; deduped: number; viaPush?: number; viaSms?: number }>("/api/admin/marketing/messaging", {
        method: "POST",
        json: {
          audience: audienceFilter,
          channel,
          templateId: templateId || undefined,
          subject,
          body,
          attachmentUrls: channel === "EMAIL" && attachments.length ? attachments : undefined,
          scheduledFor: schedule && scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
          saveAsTemplateName: saveAs && saveAsName.trim() ? saveAsName.trim() : undefined,
        },
      });
      const parts = [
        res.sent ? `${res.sent} sent` : null,
        channel === "PUSH" && (res.viaPush || res.viaSms) ? `${res.viaPush ?? 0} push · ${res.viaSms ?? 0} text` : null,
        res.queued ? `${res.queued} scheduled` : null,
        res.failed ? `${res.failed} failed` : null,
        res.deduped ? `${res.deduped} duplicate address${res.deduped === 1 ? "" : "es"} skipped` : null,
      ].filter(Boolean);
      toast({ tone: res.failed && !res.sent && !res.queued ? "error" : "success", title: `Broadcast ${schedule ? "scheduled" : "sent"}`, description: `${parts.join(" · ")} (audience ${res.audienceSize})` });
      router.push(adminRoutes.loc.marketing.messaging(location.slug));
    } catch (e) {
      onError(e, "Send failed");
    } finally {
      setBusy(null);
    }
  }

  const minDateTime = new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16);

  return (
    <div className="space-y-6">
      <PageHeader title="Compose broadcast" description={`To members of ${location.name}. Opt-outs, duplicates and quiet hours (9pm–9am for texts and push) are handled automatically.`} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Message" />

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select label="Channel" value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              <option value="PUSH">App push (text fallback){comms.pushEnabled === false ? " — push off in org" : ""}</option>
              <option value="SMS">SMS only{comms.smsEnabled ? "" : " (disabled in org)"}</option>
              <option value="EMAIL">Email{comms.emailEnabled ? "" : " (disabled in org)"}</option>
            </Select>
            <div className="sm:col-span-2">
              <Select label="Start from template (optional)" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">— None —</option>
                {templates
                  .filter((t) => (channel === "EMAIL" ? t.channel === "EMAIL" : t.channel === "SMS"))
                  .map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
              </Select>
            </div>
          </div>

          {channelDisabled && (
            <p className="mt-3 rounded-apple-sm bg-apple-orange/10 p-2 text-apple-xs text-apple-orange">
              {channel === "EMAIL" ? "Email" : "SMS"} is turned off for this organization. Messages will be skipped until it is re-enabled in Settings → Communications.
            </p>
          )}
          {channel === "PUSH" && (
            <p className="mt-3 rounded-apple-sm bg-apple-fill-secondary p-2 text-apple-xs text-apple-text-secondary">
              Members who have the Tee24 app with notifications on get a push notification; everyone else gets this as a text message. Keep it short — it is one message either way.
            </p>
          )}

          {channel === "EMAIL" && (
            <div className="mt-4">
              <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          )}
          {channel === "PUSH" && (
            <div className="mt-4">
              <Input label="Notification title (optional)" placeholder={location.name} value={subject} onChange={(e) => setSubject(e.target.value)} hint="Shown as the push title. Not included in the text-message fallback." />
            </div>
          )}
          <div className="mt-4">
            <Textarea
              ref={bodyRef}
              label={channel === "EMAIL" ? "Body (HTML or plain text)" : channel === "PUSH" ? "Message" : "Text message"}
              rows={channel === "EMAIL" ? 10 : 5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <MergeFieldChips fields={mergeFields.map((k) => ({ key: k }))} targetRef={bodyRef} onInsert={(tok) => setBody((b) => b + tok)} />
              {isText && <SegmentCounter text={body} />}
            </div>
          </div>

          {channel === "EMAIL" && (
            <div className="mt-4">
              <Field label="Attachments (public URLs)" hint="PDFs, images or waivers hosted anywhere. Resend fetches them at send time.">
                <div className="flex gap-2">
                  <Input placeholder="https://…/schedule.pdf" value={attachmentDraft} onChange={(e) => setAttachmentDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAttachment(); } }} />
                  <Button variant="secondary" iconLeft={<Paperclip className="h-4 w-4" />} onClick={addAttachment}>Add</Button>
                </div>
                {attachments.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {attachments.map((u) => (
                      <li key={u} className="flex items-center justify-between rounded-apple-sm bg-apple-fill-secondary px-2 py-1 text-apple-xs">
                        <span className="truncate">{u}</span>
                        <button type="button" onClick={() => setAttachments((a) => a.filter((x) => x !== u))} aria-label="Remove"><X className="h-3 w-3" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </Field>
            </div>
          )}

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-apple border border-apple-border p-3">
              <label className="flex items-center gap-2 text-apple-sm font-medium text-apple-text">
                <input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} /> <CalendarClock className="h-4 w-4" /> Schedule for later
              </label>
              {schedule && <div className="mt-2"><Input type="datetime-local" min={minDateTime} value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} /></div>}
            </div>
            <div className="rounded-apple border border-apple-border p-3">
              <label className="flex items-center gap-2 text-apple-sm font-medium text-apple-text">
                <input type="checkbox" checked={saveAs} onChange={(e) => setSaveAs(e.target.checked)} /> <Save className="h-4 w-4" /> Save as template
              </label>
              {saveAs && <div className="mt-2"><Input placeholder="Template name" value={saveAsName} onChange={(e) => setSaveAsName(e.target.value)} /></div>}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="text-apple-sm text-apple-text-secondary">
              Sending to <strong>{audience?.size ?? "—"}</strong> recipient{audience?.size === 1 ? "" : "s"}
              {channel === "PUSH" && audience?.channels && (
                <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                  <Badge tone="info" size="sm">{audience.channels.push} app push</Badge>
                  <Badge tone="muted" size="sm">{audience.channels.sms} text</Badge>
                  {audience.channels.unreachable > 0 && <Badge tone="warn" size="sm">{audience.channels.unreachable} no phone</Badge>}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" iconLeft={<FlaskConical className="h-4 w-4" />} onClick={sendTest} loading={busy === "test"} disabled={!body.trim() || (channel === "EMAIL" ? !admin.email : !admin.phone)}>
                Send test to me
              </Button>
              <Button iconLeft={<Send className="h-4 w-4" />} onClick={send} loading={busy === "send"} disabled={!canSend || !audience?.size}>
                {schedule ? "Schedule" : "Send now"}
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Audience" />
          <div className="mt-4 space-y-4">
            <Field label="Status">
              <MultiSelectChips options={STATUS_OPTIONS.map((s) => ({ id: s.value, label: s.label }))} value={statuses} onChange={setStatuses} />
            </Field>
            <Field label="Tags">
              <MultiSelectChips options={tags.map((t) => ({ id: t.id, label: t.name }))} value={tagIds} onChange={setTagIds} empty="No tags yet." />
            </Field>
            <Field label="Plan">
              <MultiSelectChips options={plans.map((p) => ({ id: p.id, label: p.name }))} value={planIds} onChange={setPlanIds} empty="No plans yet." />
            </Field>
            <Input label="At-risk: no visit in N days" type="number" min={0} value={inactiveDays ?? ""} onChange={(e) => setInactiveDays(e.target.value ? Number(e.target.value) : undefined)} />
            <Input label="Churn risk ≥" type="number" min={0} max={100} value={churnRiskMin ?? ""} onChange={(e) => setChurnRiskMin(e.target.value ? Number(e.target.value) : undefined)} hint="0–100. Higher = riskier." />
            <div className="flex flex-wrap gap-1 pt-2">
              <Badge tone="muted" size="sm">Opted-out excluded</Badge>
              <Badge tone="muted" size="sm">Merged members excluded</Badge>
              <Badge tone="muted" size="sm">One per {channel === "EMAIL" ? "email" : channel === "SMS" ? "phone" : "member"}</Badge>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
