"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Drawer, EmptyState, Input, Select, Textarea, useToast } from "@/components/ui";
import { Copy, Pencil, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { useAdminLocation } from "@/components/admin/LocationContext";
import { MergeFieldChips, SegmentCounter, Toggle, fmtDate, useErrorToast, useMarketingApi } from "./shared";

export type TemplateRow = {
  id: string;
  name: string;
  channel: string;
  category: string;
  subject: string | null;
  body: string;
  active: boolean;
  organizationId: string | null;
  updatedAt: string;
};

type Props = { initial: TemplateRow[]; mergeFields: readonly string[]; sample: Record<string, string> };

export function TemplatesClient({ initial, mergeFields, sample }: Props) {
  const api = useMarketingApi();
  const onError = useErrorToast();
  const router = useRouter();
  const { toast } = useToast();
  const { slug } = useAdminLocation();
  const [items, setItems] = React.useState<TemplateRow[]>(initial);
  const [channel, setChannel] = React.useState<"ALL" | "EMAIL" | "SMS">("ALL");
  const [editing, setEditing] = React.useState<TemplateRow | "new" | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function reload() {
    try {
      const res = await api<{ items: TemplateRow[] }>("/api/admin/templates");
      setItems(res.items);
    } catch (e) {
      onError(e);
    }
  }

  async function toggleActive(t: TemplateRow) {
    setItems((cur) => cur.map((x) => (x.id === t.id ? { ...x, active: !t.active } : x)));
    try {
      await api(`/api/admin/templates/${t.id}`, { method: "PATCH", json: { active: !t.active } });
    } catch (e) {
      onError(e);
      void reload();
    }
  }

  async function duplicate(t: TemplateRow) {
    setBusy(t.id);
    try {
      await api(`/api/admin/templates/${t.id}/duplicate`, { method: "POST" });
      toast({ tone: "success", title: "Template duplicated" });
      await reload();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  async function remove(t: TemplateRow) {
    if (!confirm(`Delete "${t.name}"? Automations using it will skip the step.`)) return;
    setBusy(t.id);
    try {
      await api(`/api/admin/templates/${t.id}`, { method: "DELETE" });
      setItems((cur) => cur.filter((x) => x.id !== t.id));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  const visible = items.filter((t) => channel === "ALL" || t.channel === channel);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {(["ALL", "EMAIL", "SMS"] as const).map((c) => (
            <button key={c} type="button" onClick={() => setChannel(c)} className={`rounded-apple-sm px-3 py-1.5 text-apple-sm font-medium ${channel === c ? "bg-apple-fill-secondary text-apple-text" : "text-apple-text-secondary"}`}>
              {c === "ALL" ? "All" : c === "EMAIL" ? "Email" : "SMS"} <span className="text-apple-xs text-apple-text-tertiary">{items.filter((t) => c === "ALL" || t.channel === c).length}</span>
            </button>
          ))}
        </div>
        <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>New template</Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-6 w-6" />} title="No templates yet" description="Templates are reusable bodies for broadcasts and automation steps." action={<Button onClick={() => setEditing("new")}>New template</Button>} />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-apple-divider">
            {visible.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 p-4">
                <button type="button" onClick={() => setEditing(t)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-apple-text">{t.name}</span>
                    <Badge tone="muted" size="sm">{t.channel}</Badge>
                    {t.category !== "MARKETING" && <Badge tone="info" size="sm">{t.category.toLowerCase()}</Badge>}
                    {!t.organizationId && <Badge tone="default" size="sm">shared</Badge>}
                  </div>
                  <div className="truncate text-apple-xs text-apple-text-tertiary">{t.subject ? `${t.subject} · ` : ""}{t.body.replace(/<[^>]+>/g, " ").slice(0, 100)} · updated {fmtDate(t.updatedAt, { month: "short", day: "numeric" })}</div>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <Toggle size="sm" checked={t.active} onChange={() => toggleActive(t)} />
                  <Link href={`${adminRoutes.loc.marketing.compose(slug)}?template=${t.id}`} className="rounded p-1.5 text-apple-text-tertiary hover:text-apple-blue" title="Use in broadcast"><Send className="h-4 w-4" /></Link>
                  <button type="button" onClick={() => setEditing(t)} className="rounded p-1.5 text-apple-text-tertiary hover:text-apple-text" title="Edit"><Pencil className="h-4 w-4" /></button>
                  <button type="button" onClick={() => duplicate(t)} disabled={busy === t.id} className="rounded p-1.5 text-apple-text-tertiary hover:text-apple-text" title="Duplicate"><Copy className="h-4 w-4" /></button>
                  <button type="button" onClick={() => remove(t)} disabled={busy === t.id} className="rounded p-1.5 text-apple-text-tertiary hover:text-apple-red" title="Delete"><Trash2 className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <TemplateDrawer
          template={editing === "new" ? null : editing}
          mergeFields={mergeFields}
          sample={sample}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function renderPreview(text: string, sample: Record<string, string>) {
  return text.replace(/\{\{?\s*([a-zA-Z_.]+)\s*\}?\}/g, (m, k: string) => {
    const snake = k.replace(/\./g, "_").replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    return sample[k] ?? sample[snake] ?? m;
  });
}

function TemplateDrawer({ template, mergeFields, sample, onClose, onSaved }: { template: TemplateRow | null; mergeFields: readonly string[]; sample: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const api = useMarketingApi();
  const onError = useErrorToast();
  const { toast } = useToast();
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const [f, setF] = React.useState({
    name: template?.name ?? "",
    channel: (template?.channel as "EMAIL" | "SMS") ?? "EMAIL",
    category: (template?.category as "MARKETING" | "TRANSACTIONAL") ?? "MARKETING",
    subject: template?.subject ?? "",
    body: template?.body ?? "",
    active: template?.active ?? true,
  });
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  async function save() {
    setSaving(true);
    try {
      const json = { ...f, subject: f.channel === "EMAIL" ? f.subject : null };
      if (template) await api(`/api/admin/templates/${template.id}`, { method: "PATCH", json });
      else await api("/api/admin/templates", { method: "POST", json });
      toast({ tone: "success", title: template ? "Template saved" : "Template created" });
      onSaved();
    } catch (e) {
      onError(e, "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const res = await api<{ ok: boolean; error?: string; dryRun?: boolean }>("/api/admin/marketing/messaging/test", { method: "POST", json: { channel: f.channel, subject: f.subject, body: f.body } });
      toast({ tone: res.ok ? "success" : "error", title: res.ok ? `Test ${res.dryRun ? "logged (dry run)" : "sent"} to you` : "Test failed", description: res.error });
    } catch (e) {
      onError(e, "Test failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={template ? "Edit template" : "New template"}
      footer={
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" iconLeft={<Send className="h-4 w-4" />} onClick={sendTest} loading={testing} disabled={!f.body.trim()}>Send test to me</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!f.name.trim() || !f.body.trim() || (f.channel === "EMAIL" && !f.subject.trim())}>{template ? "Save" : "Create"}</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Spring reopening" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Channel" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as "EMAIL" | "SMS" })} disabled={!!template}>
            <option value="EMAIL">Email</option>
            <option value="SMS">SMS</option>
          </Select>
          <Select label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as "MARKETING" | "TRANSACTIONAL" })}>
            <option value="MARKETING">Marketing (honors opt-out, adds unsubscribe)</option>
            <option value="TRANSACTIONAL">Transactional</option>
          </Select>
        </div>
        {f.channel === "EMAIL" && <Input label="Subject" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}
        <div>
          <Textarea ref={bodyRef} label={f.channel === "EMAIL" ? "Body (HTML or plain text)" : "Text message"} rows={f.channel === "EMAIL" ? 10 : 5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <MergeFieldChips fields={mergeFields.map((k) => ({ key: k }))} targetRef={bodyRef} onInsert={(tok) => setF((cur) => ({ ...cur, body: cur.body + tok }))} />
            {f.channel === "SMS" && <SegmentCounter text={f.body} />}
          </div>
        </div>
        <div className="flex items-center justify-between rounded-apple border border-apple-border p-3">
          <div>
            <div className="text-apple-sm font-medium text-apple-text">Active</div>
            <div className="text-apple-xs text-apple-text-tertiary">Inactive templates stay available to existing automations but are hidden from the composer.</div>
          </div>
          <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
        </div>
        <div>
          <div className="mb-1.5 text-apple-xs font-medium text-apple-text-secondary">Preview with sample member</div>
          <div className="rounded-apple border border-apple-border bg-apple-fill-secondary/50 p-3 text-apple-sm">
            {f.channel === "EMAIL" && f.subject && <div className="mb-2 font-semibold text-apple-text">{renderPreview(f.subject, sample)}</div>}
            {f.channel === "EMAIL" ? (
              <div className="prose prose-sm max-w-none text-apple-text" dangerouslySetInnerHTML={{ __html: renderPreview(f.body, sample) }} />
            ) : (
              <div className="whitespace-pre-wrap text-apple-text">{renderPreview(f.body, sample)}</div>
            )}
          </div>
        </div>
      </div>
    </Drawer>
  );
}
