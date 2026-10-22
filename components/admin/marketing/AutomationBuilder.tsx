"use client";

import React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, Input, Select, Textarea, useToast } from "@/components/ui";
import { ArrowDown, ArrowUp, Copy, Pause, Play, Plus, Save, Trash2 } from "lucide-react";
import { adminRoutes } from "@/lib/admin/routes";
import { useAdminLocation } from "@/components/admin/LocationContext";
import { AUTOMATION_TRIGGER_OPTIONS, STEP_KIND_LABELS } from "./constants";
import { MergeFieldChips, MultiSelectChips, SegmentCounter, Toggle, useErrorToast, useMarketingApi } from "./shared";
import { SYSTEM_MERGE_FIELDS } from "@/lib/system-templates";

export type BuilderOptions = {
  plans: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  admins: { id: string; name: string | null; phone: string }[];
  templates: { id: string; name: string; channel: string; subject: string | null }[];
};

// Step/trigger configs are free-form JSON bags interpreted per step kind by the runner.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Cfg = Record<string, any>;
export type StepDraft = { id: string; kind: string; config: Cfg };

export type AutomationDraft = {
  id?: string;
  name: string;
  description: string;
  trigger: string;
  triggerConfig: { planIds: string[]; tagId?: string; days?: number; exitOnCancel?: boolean };
  goalConfig: { kind: string; value?: string; tagId?: string } | null;
  active: boolean;
  maxSteps: number;
  steps: StepDraft[];
};

const uid = () => Math.random().toString(36).slice(2, 10);

export function emptyDraft(): AutomationDraft {
  return { name: "", description: "", trigger: "member.created", triggerConfig: { planIds: [], exitOnCancel: true }, goalConfig: null, active: false, maxSteps: 50, steps: [] };
}

type AutomationLike = { id: string; name: string; description?: string | null; trigger: string; triggerConfig?: unknown; goalConfig?: unknown; active: boolean; maxSteps?: number | null; steps?: { id?: string; order: number; kind: string; config?: unknown }[] };
const asCfg = (v: unknown): Cfg => (v && typeof v === "object" && !Array.isArray(v) ? (v as Cfg) : {});
export function draftFromAutomation(a: AutomationLike): AutomationDraft {
  const tc = asCfg(a.triggerConfig);
  const gc = asCfg(a.goalConfig);
  return {
    id: a.id,
    name: a.name,
    description: a.description ?? "",
    trigger: a.trigger,
    triggerConfig: { planIds: tc.planIds ?? [], tagId: tc.tagId, days: tc.days, exitOnCancel: tc.exitOnCancel ?? false },
    goalConfig: gc.kind ? (gc as AutomationDraft["goalConfig"]) : null,
    active: a.active,
    maxSteps: a.maxSteps ?? 50,
    steps: (a.steps ?? []).sort((x, y) => x.order - y.order).map((s) => ({ id: s.id ?? uid(), kind: s.kind, config: (s.config as Cfg | null) ?? {} })),
  };
}

export function AutomationBuilder({ initial, options }: { initial?: AutomationDraft; options: BuilderOptions }) {
  const api = useMarketingApi();
  const router = useRouter();
  const { slug } = useAdminLocation();
  const { toast } = useToast();
  const onError = useErrorToast();
  const [d, setD] = React.useState<AutomationDraft>(() => initial ?? emptyDraft());
  const [saving, setSaving] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const isNew = !d.id;

  function payload(extra?: Partial<AutomationDraft>) {
    const x = { ...d, ...extra };
    return {
      name: x.name,
      description: x.description || null,
      trigger: x.trigger,
      triggerConfig: { planIds: x.triggerConfig.planIds, tagId: x.trigger === "tag.added" ? x.triggerConfig.tagId || undefined : undefined, days: x.trigger === "inactive-for-days" ? Number(x.triggerConfig.days ?? 30) : undefined, exitOnCancel: !!x.triggerConfig.exitOnCancel },
      goalConfig: x.goalConfig?.kind ? x.goalConfig : null,
      active: x.active,
      maxSteps: x.maxSteps,
      steps: x.steps.map((s, i) => ({ order: i, kind: s.kind, config: s.config })),
    };
  }

  async function save(extra?: Partial<AutomationDraft>) {
    if (!d.name.trim()) return onError(new Error("Give the automation a name"), "Missing name");
    setSaving(true);
    try {
      if (isNew) {
        const res = await api<{ automation: AutomationLike }>("/api/admin/marketing/automations", { method: "POST", json: payload(extra) });
        toast({ tone: "success", title: "Automation created" });
        router.replace(adminRoutes.loc.marketing.automationDetail(slug, res.automation.id));
      } else {
        const res = await api<{ automation: AutomationLike }>(`/api/admin/marketing/automations/${d.id}`, { method: "PATCH", json: payload(extra) });
        setD(draftFromAutomation(res.automation));
        toast({ tone: "success", title: "Saved" });
        router.refresh();
      }
    } catch (e) {
      onError(e, "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function duplicate() {
    if (!d.id) return;
    setBusy("dup");
    try {
      const res = await api<{ automation: AutomationLike }>(`/api/admin/marketing/automations/${d.id}/duplicate`, { method: "POST" });
      router.push(adminRoutes.loc.marketing.automationDetail(slug, res.automation.id));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!d.id || !confirm("Delete this automation and all of its enrollments?")) return;
    setBusy("del");
    try {
      await api(`/api/admin/marketing/automations/${d.id}`, { method: "DELETE" });
      router.push(adminRoutes.loc.marketing.automations(slug));
    } catch (e) {
      onError(e);
      setBusy(null);
    }
  }

  function updateStep(id: string, patch: Partial<StepDraft>) {
    setD((cur) => ({ ...cur, steps: cur.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  }
  function moveStep(idx: number, dir: -1 | 1) {
    setD((cur) => {
      const steps = [...cur.steps];
      const j = idx + dir;
      if (j < 0 || j >= steps.length) return cur;
      [steps[idx], steps[j]] = [steps[j], steps[idx]];
      return { ...cur, steps };
    });
  }
  function addStep(kind: string) {
    const defaults: Record<string, Cfg> = {
      SEND_EMAIL: { subject: "", body: "" },
      SEND_SMS: { body: "" },
      WAIT: { days: 1, hours: 0 },
      ADD_TAG: { tagId: options.tags[0]?.id ?? "" },
      REMOVE_TAG: { tagId: options.tags[0]?.id ?? "" },
      CHANGE_STATUS: { status: "ACTIVE" },
      CREATE_TASK: { title: "Follow up with {first_name} {last_name}", body: "", assignedToId: "", dueInDays: 1, priority: "NORMAL" },
      WEBHOOK: { url: "", method: "POST", payload: "{}" },
      SPLIT: { condition: { kind: "HAS_TAG", tagId: options.tags[0]?.id ?? "" }, elseAction: "EXIT", elseStep: undefined },
      EXIT: { reason: "done" },
    };
    setD((cur) => ({ ...cur, steps: [...cur.steps, { id: uid(), kind, config: defaults[kind] ?? {} }] }));
  }

  const groups = Array.from(new Set(AUTOMATION_TRIGGER_OPTIONS.map((t) => t.group)));

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <div className="mt-4 space-y-4">
            <Input label="Name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. New member welcome series" />
            <Textarea label="Description (internal)" rows={2} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Status" />
          <div className="mt-4 flex items-center justify-between">
            <div>
              <div className="text-apple-sm font-medium text-apple-text">{d.active ? "Active" : "Paused"}</div>
              <div className="text-apple-xs text-apple-text-tertiary">{d.active ? "New matching members are enrolled." : "Nothing runs while paused."}</div>
            </div>
            <Toggle checked={d.active} onChange={(v) => setD({ ...d, active: v })} label="Active" />
          </div>
          <div className="mt-4">
            <Input label="Max steps per enrollment" type="number" min={1} max={500} value={d.maxSteps} onChange={(e) => setD({ ...d, maxSteps: Number(e.target.value || 50) })} hint="Safety limit; guards against loops." />
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="text-apple-xs text-apple-text-secondary">Stop if member cancels</div>
            <Toggle size="sm" checked={!!d.triggerConfig.exitOnCancel} onChange={(v) => setD({ ...d, triggerConfig: { ...d.triggerConfig, exitOnCancel: v } })} />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Trigger" subtitle="What starts this flow for a member." />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Select label="When" value={d.trigger} onChange={(e) => setD({ ...d, trigger: e.target.value })}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {AUTOMATION_TRIGGER_OPTIONS.filter((t) => t.group === g).map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          {d.trigger === "tag.added" && (
            <Select label="Tag (any if blank)" value={d.triggerConfig.tagId ?? ""} onChange={(e) => setD({ ...d, triggerConfig: { ...d.triggerConfig, tagId: e.target.value || undefined } })}>
              <option value="">Any tag</option>
              {options.tags.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          )}
          {d.trigger === "inactive-for-days" && (
            <Input label="Days without a visit" type="number" min={1} value={d.triggerConfig.days ?? 30} onChange={(e) => setD({ ...d, triggerConfig: { ...d.triggerConfig, days: Number(e.target.value || 30) } })} hint="Evaluated daily; each member is enrolled once." />
          )}
        </div>
        <div className="mt-4">
          <div className="mb-1.5 text-apple-xs font-medium text-apple-text-secondary">Only members on these plans (optional)</div>
          <MultiSelectChips options={options.plans.map((p) => ({ id: p.id, label: p.name }))} value={d.triggerConfig.planIds} onChange={(v) => setD({ ...d, triggerConfig: { ...d.triggerConfig, planIds: v } })} empty="No plans yet." />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Select label="Goal (exit early when met)" value={d.goalConfig?.kind ?? ""} onChange={(e) => setD({ ...d, goalConfig: e.target.value ? { kind: e.target.value, value: e.target.value === "STATUS" ? "ACTIVE" : undefined, tagId: e.target.value === "TAG_ADDED" ? options.tags[0]?.id : undefined } : null })}>
            <option value="">No goal</option>
            <option value="STATUS">Member reaches a status</option>
            <option value="TAG_ADDED">Member gets a tag</option>
            <option value="PAYMENT_SUCCEEDED">Member makes a successful payment</option>
          </Select>
          {d.goalConfig?.kind === "STATUS" && (
            <Select label="Status" value={d.goalConfig.value ?? "ACTIVE"} onChange={(e) => setD({ ...d, goalConfig: { ...d.goalConfig!, value: e.target.value } })}>
              {["ACTIVE", "FROZEN", "CANCELLED", "VISITOR", "PENDING"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          )}
          {d.goalConfig?.kind === "TAG_ADDED" && (
            <Select label="Tag" value={d.goalConfig.tagId ?? ""} onChange={(e) => setD({ ...d, goalConfig: { ...d.goalConfig!, tagId: e.target.value } })}>
              {options.tags.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title={`Steps (${d.steps.length})`} subtitle="Run in order. WAIT pauses the flow; SPLIT branches; EXIT ends it." />
        <ol className="mt-4 space-y-3">
          {d.steps.map((s, i) => (
            <li key={s.id} className="rounded-apple border border-apple-border bg-apple-fill-secondary/40 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-apple-blue text-[11px] font-semibold text-white">{i + 1}</span>
                  <span className="text-apple-sm font-semibold text-apple-text">{STEP_KIND_LABELS[s.kind] ?? s.kind}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => moveStep(i, 1)} disabled={i === d.steps.length - 1} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setD({ ...d, steps: d.steps.filter((x) => x.id !== s.id) })} aria-label="Remove"><Trash2 className="h-4 w-4 text-apple-red" /></Button>
                </div>
              </div>
              <StepEditor step={s} index={i} total={d.steps.length} options={options} onChange={(cfg) => updateStep(s.id, { config: cfg })} />
            </li>
          ))}
        </ol>
        {d.steps.length === 0 && <p className="mt-4 text-center text-apple-sm text-apple-text-tertiary">No steps yet — add one below.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.keys(STEP_KIND_LABELS).map((k) => (
            <Button key={k} size="sm" variant="secondary" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={() => addStep(k)}>
              {STEP_KIND_LABELS[k]}
            </Button>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {!isNew && (
            <>
              <Button variant="secondary" iconLeft={<Copy className="h-4 w-4" />} onClick={duplicate} loading={busy === "dup"}>Duplicate</Button>
              <Button variant="danger" iconLeft={<Trash2 className="h-4 w-4" />} onClick={remove} loading={busy === "del"}>Delete</Button>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Link href={adminRoutes.loc.marketing.automations(slug)}><Button variant="ghost">Cancel</Button></Link>
          {!isNew && (
            <Button variant="secondary" iconLeft={d.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} onClick={() => { setD({ ...d, active: !d.active }); void save({ active: !d.active }); }} disabled={saving}>
              {d.active ? "Pause" : "Activate"}
            </Button>
          )}
          <Button iconLeft={<Save className="h-4 w-4" />} onClick={() => save()} loading={saving}>
            {isNew ? "Create automation" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StepEditor({ step, index, total, options, onChange }: { step: StepDraft; index: number; total: number; options: BuilderOptions; onChange: (cfg: Cfg) => void }) {
  const c = step.config;
  const set = (patch: Cfg) => onChange({ ...c, ...patch });
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  switch (step.kind) {
    case "SEND_EMAIL":
    case "SEND_SMS": {
      const isEmail = step.kind === "SEND_EMAIL";
      const tpls = options.templates.filter((t) => t.channel === (isEmail ? "EMAIL" : "SMS"));
      return (
        <div className="space-y-3">
          <Select label="Template (optional — overrides inline content)" value={c.templateId ?? ""} onChange={(e) => set({ templateId: e.target.value || undefined })}>
            <option value="">— Write inline —</option>
            {tpls.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
          {!c.templateId && (
            <>
              {isEmail && <Input label="Subject" value={c.subject ?? ""} onChange={(e) => set({ subject: e.target.value })} />}
              <Textarea ref={bodyRef} label={isEmail ? "Body (HTML or plain)" : "Message"} rows={isEmail ? 6 : 3} value={c.body ?? ""} onChange={(e) => set({ body: e.target.value })} />
              {!isEmail && <SegmentCounter text={c.body ?? ""} />}
              <MergeFieldChips fields={SYSTEM_MERGE_FIELDS.slice(0, 8)} targetRef={bodyRef} onInsert={(t) => set({ body: (c.body ?? "") + t })} />
            </>
          )}
          <p className="text-apple-xs text-apple-text-tertiary">Only sent to members opted in to {isEmail ? "email" : "SMS"} marketing.{!isEmail && " Quiet hours (9pm–9am) are respected."}</p>
        </div>
      );
    }
    case "WAIT":
      return (
        <div className="grid grid-cols-3 gap-3">
          <Input label="Days" type="number" min={0} value={c.days ?? 0} onChange={(e) => set({ days: Number(e.target.value || 0) })} />
          <Input label="Hours" type="number" min={0} value={c.hours ?? 0} onChange={(e) => set({ hours: Number(e.target.value || 0) })} />
          <Input label="Minutes" type="number" min={0} value={c.minutes ?? 0} onChange={(e) => set({ minutes: Number(e.target.value || 0) })} />
        </div>
      );
    case "ADD_TAG":
    case "REMOVE_TAG":
      return (
        <Select label="Tag" value={c.tagId ?? ""} onChange={(e) => set({ tagId: e.target.value })}>
          <option value="">Select a tag…</option>
          {options.tags.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      );
    case "CHANGE_STATUS":
      return (
        <Select label="New status" value={c.status ?? "ACTIVE"} onChange={(e) => set({ status: e.target.value })}>
          {["ACTIVE", "FROZEN", "CANCELLED", "VISITOR", "PENDING"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      );
    case "CREATE_TASK":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Input label="Task title" value={c.title ?? ""} onChange={(e) => set({ title: e.target.value })} /></div>
          <div className="sm:col-span-2"><Textarea label="Details" rows={2} value={c.body ?? ""} onChange={(e) => set({ body: e.target.value })} /></div>
          <Select label="Assign to" value={c.assignedToId ?? ""} onChange={(e) => set({ assignedToId: e.target.value || undefined })}>
            <option value="">Unassigned</option>
            {options.admins.map((a) => (
              <option key={a.id} value={a.id}>{a.name ?? a.phone}</option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Due in (days)" type="number" min={0} value={c.dueInDays ?? 1} onChange={(e) => set({ dueInDays: Number(e.target.value || 0) })} />
            <Select label="Priority" value={c.priority ?? "NORMAL"} onChange={(e) => set({ priority: e.target.value })}>
              {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </div>
        </div>
      );
    case "WEBHOOK":
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <Select label="Method" value={c.method ?? "POST"} onChange={(e) => set({ method: e.target.value })}>
              {["POST", "PUT", "PATCH", "GET"].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
            <div className="sm:col-span-3"><Input label="URL" value={c.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://hooks.example.com/…" /></div>
          </div>
          <Textarea label="Extra JSON payload (merged with member fields)" rows={3} value={typeof c.payload === "string" ? c.payload : JSON.stringify(c.payload ?? {}, null, 2)} onChange={(e) => set({ payload: e.target.value })} className="font-mono" />
        </div>
      );
    case "SPLIT": {
      const cond = c.condition ?? { kind: "HAS_TAG" };
      const setCond = (p: Cfg) => set({ condition: { ...cond, ...p } });
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="If member…" value={cond.kind} onChange={(e) => setCond({ kind: e.target.value })}>
              <option value="HAS_TAG">has tag</option>
              <option value="PLAN">is on plan</option>
              <option value="OPENED_LAST_EMAIL">opened the last email</option>
              <option value="STATUS">has status</option>
            </Select>
            {cond.kind === "HAS_TAG" && (
              <Select label="Tag" value={cond.tagId ?? ""} onChange={(e) => setCond({ tagId: e.target.value })}>
                <option value="">Select…</option>
                {options.tags.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            )}
            {cond.kind === "PLAN" && (
              <Select label="Plan" value={cond.planId ?? ""} onChange={(e) => setCond({ planId: e.target.value })}>
                <option value="">Select…</option>
                {options.plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            )}
            {cond.kind === "STATUS" && (
              <Select label="Status" value={cond.status ?? "ACTIVE"} onChange={(e) => setCond({ status: e.target.value })}>
                {["ACTIVE", "FROZEN", "CANCELLED", "VISITOR", "PENDING"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-apple-sm border border-apple-green/30 bg-apple-green/5 p-3 text-apple-xs text-apple-text-secondary">
              <strong className="text-apple-green">Branch A (matches):</strong> continue to step {index + 2 <= total ? index + 2 : "— (end)"}.
            </div>
            <div className="space-y-2 rounded-apple-sm border border-apple-border p-3">
              <div className="text-apple-xs text-apple-text-secondary"><strong>Branch B (doesn&apos;t match):</strong></div>
              <Select value={c.elseAction ?? "EXIT"} onChange={(e) => set({ elseAction: e.target.value })}>
                <option value="EXIT">Exit the automation</option>
                <option value="JUMP">Jump to step…</option>
              </Select>
              {c.elseAction === "JUMP" && (
                <Select value={c.elseStep ?? ""} onChange={(e) => set({ elseStep: e.target.value === "" ? undefined : Number(e.target.value) })}>
                  <option value="">Select step…</option>
                  {Array.from({ length: total }, (_, i) => i).filter((i) => i !== index).map((i) => (
                    <option key={i} value={i}>Step {i + 1}</option>
                  ))}
                </Select>
              )}
            </div>
          </div>
        </div>
      );
    }
    case "EXIT":
      return <Input label="Reason (for reporting)" value={c.reason ?? ""} onChange={(e) => set({ reason: e.target.value })} />;
    default:
      return <Badge tone="warn">Unknown step kind</Badge>;
  }
}
