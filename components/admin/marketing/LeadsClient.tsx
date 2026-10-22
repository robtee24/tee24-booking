"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Button, Card, Drawer, EmptyState, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { Columns3, List, Mail, MessageSquare, Phone, Plus, Upload, UserCheck, UserPlus } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { useAdminLocation } from "@/components/admin/LocationContext";
import { LEAD_STAGES, LEAD_STAGE_TONES, type LeadStage } from "./constants";
import { Field, SegmentCounter, fmtDate, useErrorToast, useMarketingApi } from "./shared";

export type LeadRow = {
  id: string;
  stage: LeadStage;
  source: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  tags: string[];
  assignedToId: string | null;
  nextFollowUpAt: string | null;
  lastContactedAt: string | null;
  convertedToMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  initial: LeadRow[];
  sources: string[];
  admins: { id: string; name: string | null; phone: string }[];
  stageLabels: Record<LeadStage, string>;
  currentAdminId: string | null;
};

type LeadDetail = {
  events: { id: string; kind: string; createdAt: string; data?: { note?: string; from?: string; to?: string } | null }[];
  messages: { id: string; createdAt: string; direction: string; channel: string; subject: string | null; body: string }[];
};

const ACTIVITY_KINDS = ["NOTE", "CALL", "EMAIL", "SMS", "TOUR", "VISIT", "MEETING", "OTHER"];

function leadName(l: Pick<LeadRow, "firstName" | "lastName" | "email" | "phone">) {
  return `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim() || l.email || l.phone || "(no name)";
}

function isDue(iso: string | null) {
  if (!iso) return false;
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return new Date(iso) <= end;
}

export function LeadsClient({ initial, sources, admins, stageLabels, currentAdminId }: Props) {
  const api = useMarketingApi();
  const onError = useErrorToast();
  const router = useRouter();
  const sp = useSearchParams();
  const [leads, setLeads] = React.useState<LeadRow[]>(initial);
  const [view, setView] = React.useState<"kanban" | "list">("kanban");
  const [filters, setFilters] = React.useState({ stage: "ALL", source: "", assignedToId: "", followUp: "", search: "" });
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(sp.get("lead"));
  const adminName = (id: string | null) => (id ? admins.find((a) => a.id === id)?.name ?? "Staff" : null);

  const reload = React.useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (filters.stage !== "ALL") q.set("stage", filters.stage);
      if (filters.source) q.set("source", filters.source);
      if (filters.assignedToId) q.set("assignedToId", filters.assignedToId);
      if (filters.followUp) q.set("followUp", filters.followUp);
      if (filters.search) q.set("search", filters.search);
      const res = await api<{ items: LeadRow[] }>(`/api/admin/visitors?${q.toString()}`);
      setLeads(res.items);
    } catch (e) {
      onError(e);
    }
  }, [api, filters, onError]);

  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(reload, 250);
    return () => clearTimeout(t);
  }, [filters, reload]);

  async function moveStage(lead: LeadRow, stage: LeadStage) {
    if (lead.stage === stage) return;
    setLeads((cur) => cur.map((l) => (l.id === lead.id ? { ...l, stage } : l)));
    try {
      await api(`/api/admin/visitors/${lead.id}`, { method: "PATCH", json: { stage } });
    } catch (e) {
      onError(e);
      void reload();
    }
  }

  const visibleStages = LEAD_STAGES.filter((s) => filters.stage === "ALL" || filters.stage === s);
  const open = openId ? leads.find((l) => l.id === openId) ?? null : null;

  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
          <div className="flex flex-1 flex-wrap gap-2">
            <Select value={filters.stage} onChange={(e) => setFilters({ ...filters, stage: e.target.value })} aria-label="Stage">
              <option value="ALL">All stages</option>
              {LEAD_STAGES.map((s) => (
                <option key={s} value={s}>{stageLabels[s]}</option>
              ))}
            </Select>
            <Select value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })} aria-label="Source">
              <option value="">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
            <Select value={filters.assignedToId} onChange={(e) => setFilters({ ...filters, assignedToId: e.target.value })} aria-label="Assignee">
              <option value="">Anyone</option>
              {currentAdminId && <option value={currentAdminId}>Assigned to me</option>}
              <option value="unassigned">Unassigned</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>{a.name ?? a.phone}</option>
              ))}
            </Select>
            <Select value={filters.followUp} onChange={(e) => setFilters({ ...filters, followUp: e.target.value })} aria-label="Follow-up">
              <option value="">Any follow-up</option>
              <option value="today">Due today</option>
              <option value="overdue">Overdue</option>
              <option value="due">Due or overdue</option>
              <option value="none">No follow-up set</option>
            </Select>
            <div className="min-w-[180px] flex-1">
              <Input placeholder="Search leads…" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-apple-sm border border-apple-border p-0.5">
              <button type="button" onClick={() => setView("kanban")} className={`rounded px-2 py-1 ${view === "kanban" ? "bg-apple-fill-secondary text-apple-text" : "text-apple-text-tertiary"}`} aria-label="Kanban"><Columns3 className="h-4 w-4" /></button>
              <button type="button" onClick={() => setView("list")} className={`rounded px-2 py-1 ${view === "list" ? "bg-apple-fill-secondary text-apple-text" : "text-apple-text-tertiary"}`} aria-label="List"><List className="h-4 w-4" /></button>
            </div>
            <Button variant="secondary" size="sm" iconLeft={<Upload className="h-4 w-4" />} onClick={() => setImporting(true)}>Import CSV</Button>
            <Button size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New lead</Button>
          </div>
        </div>
      </Card>

      {leads.length === 0 ? (
        <EmptyState icon={<UserPlus className="h-6 w-6" />} title="No leads match" description="Leads are created here, from inbound texts, day-pass purchases and signup-form starts." action={<Button onClick={() => setCreating(true)}>New lead</Button>} />
      ) : view === "kanban" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2">
          <div className="flex min-w-max gap-3">
            {visibleStages.map((stage) => {
              const col = leads.filter((l) => l.stage === stage);
              return (
                <div key={stage} className="w-64 shrink-0 rounded-apple bg-apple-fill-secondary/60 p-2">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-apple-xs font-semibold uppercase tracking-wide text-apple-text-secondary">{stageLabels[stage]}</span>
                    <Badge tone={LEAD_STAGE_TONES[stage]} size="sm">{col.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {col.map((l) => (
                      <button key={l.id} type="button" onClick={() => setOpenId(l.id)} className="w-full rounded-apple-sm border border-apple-border bg-white p-3 text-left shadow-apple-sm hover:border-apple-blue">
                        <div className="truncate text-apple-sm font-medium text-apple-text">{leadName(l)}</div>
                        <div className="truncate text-apple-xs text-apple-text-tertiary">{l.email ?? l.phone ?? "—"}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {l.source && <Badge tone="muted" size="sm">{l.source}</Badge>}
                          {l.nextFollowUpAt && <Badge tone={isDue(l.nextFollowUpAt) ? "warn" : "info"} size="sm">{isDue(l.nextFollowUpAt) ? "Due " : ""}{fmtDate(l.nextFollowUpAt, { month: "short", day: "numeric" })}</Badge>}
                          {l.assignedToId && <Badge tone="default" size="sm">{adminName(l.assignedToId)}</Badge>}
                        </div>
                      </button>
                    ))}
                    {col.length === 0 && <div className="rounded-apple-sm border border-dashed border-apple-border p-3 text-center text-apple-xs text-apple-text-tertiary">Empty</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-apple-divider">
            {leads.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => setOpenId(l.id)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-apple-fill-secondary/50">
                  <div className="min-w-0">
                    <div className="truncate text-apple-sm font-medium text-apple-text">{leadName(l)}</div>
                    <div className="truncate text-apple-xs text-apple-text-tertiary">{[l.email, l.phone, l.source].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {l.nextFollowUpAt && <span className={`text-apple-xs ${isDue(l.nextFollowUpAt) ? "text-apple-orange" : "text-apple-text-tertiary"}`}>{fmtDate(l.nextFollowUpAt, { month: "short", day: "numeric" })}</span>}
                    {l.assignedToId && <Badge tone="default" size="sm">{adminName(l.assignedToId)}</Badge>}
                    <Badge tone={LEAD_STAGE_TONES[l.stage]} size="sm">{stageLabels[l.stage]}</Badge>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {creating && (
        <LeadForm
          sources={sources}
          admins={admins}
          stageLabels={stageLabels}
          onClose={() => setCreating(false)}
          onSaved={(l) => {
            setLeads((cur) => [l, ...cur]);
            setCreating(false);
            router.refresh();
          }}
        />
      )}

      {importing && <ImportModal sources={sources} onClose={() => setImporting(false)} onDone={() => { setImporting(false); void reload(); router.refresh(); }} />}

      {open && (
        <LeadDrawer
          key={open.id}
          lead={open}
          sources={sources}
          admins={admins}
          stageLabels={stageLabels}
          onClose={() => setOpenId(null)}
          onChange={(l) => setLeads((cur) => cur.map((x) => (x.id === l.id ? { ...x, ...l } : x)))}
          onStage={(s) => moveStage(open, s)}
          onDeleted={() => { setLeads((cur) => cur.filter((x) => x.id !== open.id)); setOpenId(null); }}
        />
      )}
    </div>
  );
}

// ── Create / edit form ───────────────────────────────────────────────────────
function LeadForm({ lead, sources, admins, stageLabels, onClose, onSaved }: { lead?: LeadRow; sources: string[]; admins: Props["admins"]; stageLabels: Record<LeadStage, string>; onClose: () => void; onSaved: (l: LeadRow) => void }) {
  const api = useMarketingApi();
  const onError = useErrorToast();
  const [f, setF] = React.useState({
    firstName: lead?.firstName ?? "",
    lastName: lead?.lastName ?? "",
    email: lead?.email ?? "",
    phone: lead?.phone ?? "",
    source: lead?.source ?? sources[0] ?? "",
    stage: (lead?.stage ?? "NEW") as LeadStage,
    notes: lead?.notes ?? "",
    tags: (lead?.tags ?? []).join(", "),
    assignedToId: lead?.assignedToId ?? "",
    nextFollowUpAt: lead?.nextFollowUpAt ? lead.nextFollowUpAt.slice(0, 10) : "",
  });
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    try {
      const json = { ...f, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), nextFollowUpAt: f.nextFollowUpAt ? new Date(`${f.nextFollowUpAt}T09:00:00`).toISOString() : null, assignedToId: f.assignedToId || null };
      const res = lead
        ? await api<{ lead: Omit<LeadRow, "stage" | "tags"> & { stage: string; tags: unknown } }>(`/api/admin/visitors/${lead.id}`, { method: "PATCH", json })
        : await api<{ lead: Omit<LeadRow, "stage" | "tags"> & { stage: string; tags: unknown } }>("/api/admin/visitors", { method: "POST", json });
      onSaved({ ...res.lead, stage: (res.lead.stage === "ENGAGED" ? "CONTACTED" : res.lead.stage) as LeadStage, tags: Array.isArray(res.lead.tags) ? (res.lead.tags as string[]) : [] });
    } catch (e) {
      onError(e, "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={lead ? "Edit lead" : "New lead"} footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>{lead ? "Save" : "Create lead"}</Button></div>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="First name" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
          <Input label="Last name" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
        </div>
        <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Input label="Mobile phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Source" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
            <option value="">—</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            {f.source && !sources.includes(f.source) && <option value={f.source}>{f.source}</option>}
          </Select>
          <Select label="Stage" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as LeadStage })}>
            {LEAD_STAGES.map((s) => (
              <option key={s} value={s}>{stageLabels[s]}</option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Assign to" value={f.assignedToId} onChange={(e) => setF({ ...f, assignedToId: e.target.value })}>
            <option value="">Unassigned</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>{a.name ?? a.phone}</option>
            ))}
          </Select>
          <Input label="Next follow-up" type="date" value={f.nextFollowUpAt} onChange={(e) => setF({ ...f, nextFollowUpAt: e.target.value })} />
        </div>
        <Input label="Tags (comma separated)" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />
        <Textarea label="Notes" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
    </Drawer>
  );
}

// ── Detail drawer ────────────────────────────────────────────────────────────
function LeadDrawer({ lead, sources, admins, stageLabels, onClose, onChange, onStage, onDeleted }: { lead: LeadRow; sources: string[]; admins: Props["admins"]; stageLabels: Record<LeadStage, string>; onClose: () => void; onChange: (l: Partial<LeadRow> & { id: string }) => void; onStage: (s: LeadStage) => void; onDeleted: () => void }) {
  const api = useMarketingApi();
  const { slug } = useAdminLocation();
  const { toast } = useToast();
  const onError = useErrorToast();
  const router = useRouter();
  const [detail, setDetail] = React.useState<LeadDetail | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [tab, setTab] = React.useState<"activity" | "message" | "convert">("activity");
  const [act, setAct] = React.useState({ kind: "NOTE", note: "", nextFollowUpAt: "" });
  const [msg, setMsg] = React.useState({ channel: lead.phone ? "SMS" : "EMAIL", subject: "", body: "" });
  const [conv, setConv] = React.useState({ firstName: lead.firstName ?? "", lastName: lead.lastName ?? "", email: lead.email ?? "", phone: lead.phone ?? "", status: "PENDING", optInSmsMarketing: false });
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await api<{ lead: LeadDetail }>(`/api/admin/visitors/${lead.id}`);
      setDetail(res.lead);
    } catch (e) {
      onError(e);
    }
  }, [api, lead.id, onError]);
  React.useEffect(() => { void load(); }, [load]);

  async function logActivity() {
    setBusy("act");
    try {
      await api(`/api/admin/visitors/${lead.id}/activity`, { method: "POST", json: { kind: act.kind, note: act.note, nextFollowUpAt: act.nextFollowUpAt ? new Date(`${act.nextFollowUpAt}T09:00:00`).toISOString() : undefined } });
      onChange({ id: lead.id, lastContactedAt: new Date().toISOString(), ...(act.nextFollowUpAt ? { nextFollowUpAt: new Date(`${act.nextFollowUpAt}T09:00:00`).toISOString() } : {}) });
      setAct({ kind: "NOTE", note: "", nextFollowUpAt: "" });
      await load();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  async function sendMessage() {
    setBusy("msg");
    try {
      const res = await api<{ ok: boolean; error?: string }>(`/api/admin/visitors/${lead.id}/message`, { method: "POST", json: msg });
      toast({ tone: res.ok ? "success" : "error", title: res.ok ? "Message sent" : "Send failed", description: res.error });
      setMsg({ ...msg, body: "", subject: "" });
      if (lead.stage === "NEW") onChange({ id: lead.id, stage: "CONTACTED" });
      await load();
    } catch (e) {
      onError(e, "Send failed");
    } finally {
      setBusy(null);
    }
  }

  async function convert() {
    setBusy("conv");
    try {
      const res = await api<{ memberId: string; existingMember: boolean }>(`/api/admin/visitors/${lead.id}/convert`, { method: "POST", json: conv });
      toast({ tone: "success", title: res.existingMember ? "Linked to existing member" : "Member created" });
      onChange({ id: lead.id, stage: "CONVERTED", convertedToMemberId: res.memberId });
      router.push(adminRoutes.loc.members.detail(slug, res.memberId));
    } catch (e) {
      onError(e, "Conversion failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm("Delete this lead?")) return;
    try {
      await api(`/api/admin/visitors/${lead.id}`, { method: "DELETE" });
      onDeleted();
    } catch (e) {
      onError(e);
    }
  }

  const timeline: { id: string; at: string; label: string; detail?: string }[] = [
    ...(detail?.events ?? []).map((e) => ({ id: e.id, at: e.createdAt, label: e.kind.replace(/_/g, " ").toLowerCase(), detail: e.data?.note ?? (e.data?.from ? `${e.data.from} → ${e.data.to}` : undefined) })),
    ...(detail?.messages ?? []).map((m) => ({ id: m.id, at: m.createdAt, label: `${m.direction === "INBOUND" ? "received" : "sent"} ${m.channel.toLowerCase()}`, detail: m.subject ? `${m.subject} — ${m.body.slice(0, 120)}` : m.body.slice(0, 160) })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  if (editing) {
    return (
      <LeadForm
        lead={lead}
        sources={sources}
        admins={admins}
        stageLabels={stageLabels}
        onClose={() => setEditing(false)}
        onSaved={(l) => {
          onChange(l);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <Drawer open onClose={onClose} width="lg" title={leadName(lead)} description={[lead.email, lead.phone, lead.source ? `via ${lead.source}` : null].filter(Boolean).join(" · ")}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={lead.stage} onChange={(e) => onStage(e.target.value as LeadStage)} aria-label="Stage" disabled={!!lead.convertedToMemberId}>
            {LEAD_STAGES.map((s) => (
              <option key={s} value={s}>{stageLabels[s]}</option>
            ))}
          </Select>
          {lead.nextFollowUpAt && <Badge tone={isDue(lead.nextFollowUpAt) ? "warn" : "info"}>Follow up {fmtDate(lead.nextFollowUpAt, { month: "short", day: "numeric" })}</Badge>}
          {lead.assignedToId && <Badge tone="default">{admins.find((a) => a.id === lead.assignedToId)?.name ?? "Assigned"}</Badge>}
          {lead.tags.map((t) => <Badge key={t} tone="muted" size="sm">{t}</Badge>)}
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={remove}><span className="text-apple-red">Delete</span></Button>
          </div>
        </div>

        {lead.convertedToMemberId && (
          <div className="flex items-center justify-between rounded-apple-sm border border-apple-green/30 bg-apple-green/5 p-3 text-apple-sm">
            <span className="flex items-center gap-2 text-apple-green"><UserCheck className="h-4 w-4" /> Converted to member</span>
            <Link href={adminRoutes.loc.members.detail(slug, lead.convertedToMemberId)} className="font-medium text-apple-blue hover:underline">Open profile →</Link>
          </div>
        )}

        {lead.notes && <p className="whitespace-pre-wrap rounded-apple-sm bg-apple-fill-secondary p-3 text-apple-sm text-apple-text-secondary">{lead.notes}</p>}

        <div className="flex gap-1 border-b border-apple-divider">
          {([["activity", "Log activity"], ["message", "Quick message"], ["convert", "Convert to member"]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`px-3 py-2 text-apple-sm font-medium ${tab === k ? "border-b-2 border-apple-blue text-apple-text" : "text-apple-text-secondary"}`}>{label}</button>
          ))}
        </div>

        {tab === "activity" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Select label="Type" value={act.kind} onChange={(e) => setAct({ ...act, kind: e.target.value })}>
                {ACTIVITY_KINDS.map((k) => (
                  <option key={k} value={k}>{k.charAt(0) + k.slice(1).toLowerCase()}</option>
                ))}
              </Select>
              <Input label="Next follow-up" type="date" value={act.nextFollowUpAt} onChange={(e) => setAct({ ...act, nextFollowUpAt: e.target.value })} />
            </div>
            <Textarea label="Note" rows={2} value={act.note} onChange={(e) => setAct({ ...act, note: e.target.value })} />
            <div className="flex justify-end"><Button size="sm" onClick={logActivity} loading={busy === "act"}>Log activity</Button></div>
          </div>
        )}

        {tab === "message" && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button size="sm" variant={msg.channel === "SMS" ? "primary" : "secondary"} iconLeft={<MessageSquare className="h-4 w-4" />} onClick={() => setMsg({ ...msg, channel: "SMS" })} disabled={!lead.phone}>SMS</Button>
              <Button size="sm" variant={msg.channel === "EMAIL" ? "primary" : "secondary"} iconLeft={<Mail className="h-4 w-4" />} onClick={() => setMsg({ ...msg, channel: "EMAIL" })} disabled={!lead.email}>Email</Button>
              {lead.phone && <a href={`tel:${lead.phone}`} className="ml-auto inline-flex items-center gap-1 text-apple-sm text-apple-blue"><Phone className="h-4 w-4" /> Call</a>}
            </div>
            {msg.channel === "EMAIL" && <Input label="Subject" value={msg.subject} onChange={(e) => setMsg({ ...msg, subject: e.target.value })} />}
            <Textarea label={msg.channel === "SMS" ? "Text message" : "Email body"} rows={4} value={msg.body} onChange={(e) => setMsg({ ...msg, body: e.target.value })} hint="Merge fields: {first_name} {last_name} {location_name}" />
            {msg.channel === "SMS" && <SegmentCounter text={msg.body} />}
            <div className="flex justify-end"><Button size="sm" onClick={sendMessage} loading={busy === "msg"} disabled={!msg.body.trim()}>Send {msg.channel === "SMS" ? "text" : "email"}</Button></div>
          </div>
        )}

        {tab === "convert" && (
          <div className="space-y-3">
            {lead.convertedToMemberId ? (
              <p className="text-apple-sm text-apple-text-secondary">This lead is already a member.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="First name" value={conv.firstName} onChange={(e) => setConv({ ...conv, firstName: e.target.value })} />
                  <Input label="Last name" value={conv.lastName} onChange={(e) => setConv({ ...conv, lastName: e.target.value })} />
                  <Input label="Email" value={conv.email} onChange={(e) => setConv({ ...conv, email: e.target.value })} />
                  <Input label="Phone" value={conv.phone} onChange={(e) => setConv({ ...conv, phone: e.target.value })} />
                  <Select label="Initial status" value={conv.status} onChange={(e) => setConv({ ...conv, status: e.target.value })}>
                    <option value="PENDING">Pending (no membership yet)</option>
                    <option value="VISITOR">Visitor</option>
                    <option value="ACTIVE">Active</option>
                  </Select>
                  <Field label="SMS marketing consent">
                    <label className="flex items-center gap-2 pt-2 text-apple-sm"><input type="checkbox" checked={conv.optInSmsMarketing} onChange={(e) => setConv({ ...conv, optInSmsMarketing: e.target.checked })} /> Lead agreed to texts</label>
                  </Field>
                </div>
                <div className="flex justify-end"><Button size="sm" iconLeft={<UserCheck className="h-4 w-4" />} onClick={convert} loading={busy === "conv"}>Create member</Button></div>
              </>
            )}
          </div>
        )}

        <div>
          <div className="mb-2 text-apple-xs font-semibold uppercase tracking-wide text-apple-text-tertiary">Timeline</div>
          {!detail ? (
            <p className="text-apple-xs text-apple-text-tertiary">Loading…</p>
          ) : timeline.length === 0 ? (
            <p className="text-apple-xs text-apple-text-tertiary">No activity yet.</p>
          ) : (
            <ul className="space-y-2">
              {timeline.map((t) => (
                <li key={t.id} className="flex gap-3 text-apple-sm">
                  <span className="w-28 shrink-0 text-apple-xs text-apple-text-tertiary">{fmtDate(t.at)}</span>
                  <div className="min-w-0">
                    <span className="font-medium capitalize text-apple-text">{t.label}</span>
                    {t.detail && <div className="truncate text-apple-xs text-apple-text-secondary">{t.detail}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  );
}

// ── CSV import ───────────────────────────────────────────────────────────────
function ImportModal({ sources, onClose, onDone }: { sources: string[]; onClose: () => void; onDone: () => void }) {
  const api = useMarketingApi();
  const { toast } = useToast();
  const onError = useErrorToast();
  const [csv, setCsv] = React.useState("");
  const [source, setSource] = React.useState("Import");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ created: number; skipped: number; errors: string[] } | null>(null);

  async function run() {
    setBusy(true);
    try {
      const res = await api<{ created: number; skipped: number; errors: string[] }>("/api/admin/visitors/import", { method: "POST", json: { csv, defaultSource: source } });
      setResult(res);
      toast({ tone: "success", title: `Imported ${res.created} leads`, description: res.skipped ? `${res.skipped} skipped (duplicates/empty)` : undefined });
    } catch (e) {
      onError(e, "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Import leads from CSV" description="Header row required: firstName,lastName,email,phone,source,stage,notes,tags,nextFollowUpAt (any order, extra columns ignored)." wide footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={result ? onDone : onClose}>{result ? "Done" : "Cancel"}</Button>{!result && <Button onClick={run} loading={busy} disabled={!csv.trim()}>Import</Button>}</div>}>
      <div className="space-y-3">
        <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(setCsv); }} className="text-apple-sm" />
        <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"firstName,lastName,email,phone,source\nJordan,Sample,jordan@example.com,5555550123,Walk-by"} className="font-mono" />
        <Select label="Default source (when column missing)" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="Import">Import</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        {result && result.errors.length > 0 && <ul className="max-h-32 overflow-auto rounded-apple-sm bg-apple-red/5 p-2 text-apple-xs text-apple-red">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      </div>
    </Modal>
  );
}
