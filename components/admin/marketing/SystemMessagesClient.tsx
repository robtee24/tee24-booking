"use client";

import React from "react";
import { Button, Card, Drawer, Input, Textarea, useToast } from "@/components/ui";
import { Mail, MessageSquare, RotateCcw, Send } from "lucide-react";
import { MergeFieldChips, SegmentCounter, Toggle, useErrorToast, useMarketingApi } from "./shared";
import { SAMPLE_MEMBER_VARS, SYSTEM_MERGE_FIELDS, SYSTEM_TEMPLATE_GROUPS, renderSystemTemplate, type SystemTemplateGroup } from "@/lib/system-templates";

type Row = { id: string; eventKey: string; channel: "EMAIL" | "SMS"; subject: string | null; body: string; active: boolean; isDefault: boolean };
type Entry = { def: { eventKey: string; group: SystemTemplateGroup; label: string; description: string }; email: Row; sms: Row };

export function SystemMessagesClient({ initial, adminEmail, adminPhone }: { initial: Entry[]; adminEmail: string | null; adminPhone: string | null }) {
  const api = useMarketingApi();
  const { toast } = useToast();
  const onError = useErrorToast();
  const [entries, setEntries] = React.useState<Entry[]>(initial);
  const [editing, setEditing] = React.useState<{ entry: Entry; row: Row } | null>(null);

  function patchRow(updated: Row) {
    setEntries((cur) => cur.map((e) => (e.def.eventKey === updated.eventKey ? { ...e, [updated.channel === "EMAIL" ? "email" : "sms"]: { ...(updated.channel === "EMAIL" ? e.email : e.sms), ...updated } } : e)));
  }

  async function toggle(row: Row, active: boolean) {
    patchRow({ ...row, active });
    try {
      await api("/api/admin/marketing/system-messages", { method: "PATCH", json: { id: row.id, active } });
    } catch (e) {
      patchRow({ ...row, active: !active });
      onError(e, "Could not update");
    }
  }

  async function sendTest(row: Row, override?: { subject: string | null; body: string }) {
    try {
      const res = await api<{ ok: boolean; to?: string; dryRun?: boolean }>("/api/admin/marketing/system-messages/test", {
        method: "POST",
        json: { templateId: row.id, channel: row.channel, subject: override?.subject, body: override?.body },
      });
      toast({ tone: "success", title: res.dryRun ? "Test logged (dry run)" : "Test sent", description: `To ${res.to}` });
    } catch (e) {
      onError(e, "Test send failed");
    }
  }

  return (
    <div className="space-y-6">
      {SYSTEM_TEMPLATE_GROUPS.map((group) => {
        const rows = entries.filter((e) => e.def.group === group);
        if (rows.length === 0) return null;
        return (
          <Card key={group} padded={false}>
            <div className="border-b border-apple-divider px-4 py-3">
              <div className="text-apple-sm font-semibold text-apple-text">{group}</div>
            </div>
            <ul className="divide-y divide-apple-divider">
              {rows.map((e) => (
                <li key={e.def.eventKey} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-apple-text">{e.def.label}</div>
                    <div className="text-apple-xs text-apple-text-tertiary">{e.def.description}</div>
                    <div className="mt-1 font-mono text-[10px] text-apple-text-tertiary">{e.def.eventKey}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <ChannelControl icon={<Mail className="h-4 w-4" />} label="Email" row={e.email} onToggle={(v) => toggle(e.email, v)} onEdit={() => setEditing({ entry: e, row: e.email })} />
                    <ChannelControl icon={<MessageSquare className="h-4 w-4" />} label="SMS" row={e.sms} onToggle={(v) => toggle(e.sms, v)} onEdit={() => setEditing({ entry: e, row: e.sms })} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}

      {editing && (
        <EditDrawer
          key={editing.row.id}
          entry={editing.entry}
          row={editing.row}
          adminEmail={adminEmail}
          adminPhone={adminPhone}
          onClose={() => setEditing(null)}
          onSaved={(r) => {
            patchRow(r);
            setEditing(null);
          }}
          onTest={sendTest}
        />
      )}
    </div>
  );
}

function ChannelControl({ icon, label, row, onToggle, onEdit }: { icon: React.ReactNode; label: string; row: Row; onToggle: (v: boolean) => void; onEdit: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-apple-sm border border-apple-border px-3 py-2">
      <span className="text-apple-text-tertiary">{icon}</span>
      <span className="text-apple-xs font-medium text-apple-text-secondary">{label}</span>
      <Toggle size="sm" checked={row.active} onChange={onToggle} label={`${label} on/off`} />
      <button type="button" onClick={onEdit} className="text-apple-xs font-medium text-apple-blue hover:underline">
        Edit{row.isDefault ? "" : " •"}
      </button>
    </div>
  );
}

function EditDrawer({ entry, row, adminEmail, adminPhone, onClose, onSaved, onTest }: { entry: Entry; row: Row; adminEmail: string | null; adminPhone: string | null; onClose: () => void; onSaved: (r: Row) => void; onTest: (row: Row, override: { subject: string | null; body: string }) => Promise<void> }) {
  const api = useMarketingApi();
  const onError = useErrorToast();
  const [subject, setSubject] = React.useState(row.subject ?? "");
  const [body, setBody] = React.useState(row.body);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const isEmail = row.channel === "EMAIL";
  const preview = renderSystemTemplate(body, SAMPLE_MEMBER_VARS);
  const previewSubject = renderSystemTemplate(subject, SAMPLE_MEMBER_VARS);

  async function save(reset = false) {
    setSaving(true);
    try {
      const res = await api<{ template: { id: string; active: boolean; subject: string | null; body: string } }>("/api/admin/marketing/system-messages", {
        method: "PATCH",
        json: reset ? { id: row.id, resetToDefault: true } : { id: row.id, subject: isEmail ? subject : null, body },
      });
      onSaved({ ...row, subject: res.template.subject, body: res.template.body, isDefault: reset });
    } catch (e) {
      onError(e, "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width="xl"
      title={`${entry.def.label} — ${isEmail ? "Email" : "SMS"}`}
      description={entry.def.description}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" iconLeft={<RotateCcw className="h-4 w-4" />} onClick={() => save(true)} disabled={saving}>
            Reset to default
          </Button>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              iconLeft={<Send className="h-4 w-4" />}
              loading={testing}
              title={isEmail ? `Sends to ${adminEmail ?? "(no email on your admin profile)"}` : `Sends to ${adminPhone ?? "(no phone)"}`}
              onClick={async () => {
                setTesting(true);
                await onTest(row, { subject: isEmail ? subject : null, body });
                setTesting(false);
              }}
            >
              Send test to me
            </Button>
            <Button onClick={() => save(false)} loading={saving}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {isEmail && <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />}
          <Textarea ref={bodyRef} label={isEmail ? "Body (HTML or plain text; line breaks become <br>)" : "Message"} rows={isEmail ? 14 : 6} value={body} onChange={(e) => setBody(e.target.value)} />
          {!isEmail && <SegmentCounter text={preview} />}
          <div>
            <div className="mb-1.5 text-apple-xs font-medium text-apple-text-secondary">Merge fields (click to insert)</div>
            <MergeFieldChips fields={SYSTEM_MERGE_FIELDS} targetRef={bodyRef} onInsert={(t) => setBody((b) => b + t)} />
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-apple-xs font-medium text-apple-text-secondary">Live preview (sample member: Jordan Sample)</div>
          {isEmail ? (
            <div className="rounded-apple border border-apple-border bg-white">
              <div className="border-b border-apple-divider px-4 py-2 text-apple-sm font-semibold text-apple-text">{previewSubject || <span className="text-apple-text-tertiary">(no subject)</span>}</div>
              <div className="prose prose-sm max-w-none px-4 py-3 text-apple-sm text-apple-text" dangerouslySetInnerHTML={{ __html: preview.replace(/\n/g, "<br>") }} />
            </div>
          ) : (
            <div className="flex justify-start">
              <div className="max-w-xs whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-apple-fill-secondary px-4 py-2 text-apple-sm text-apple-text">{preview}</div>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
