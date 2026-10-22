"use client";

import React from "react";
import { Badge, Button, Card, CardHeader, Input, Select, Textarea, useToast } from "@/components/ui";
import { Pause, Play, Plus, Save, X } from "lucide-react";
import { Toggle, useErrorToast, useMarketingApi } from "./shared";
import type { MarketingSettings } from "@/services/marketing.service";
import { LEAD_STAGES } from "./constants";

type Props = {
  initial: MarketingSettings;
  automations: { active: number; paused: number };
  smsFrom: string | null;
  paypalConfigured: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
};

export function MarketingSettingsClient({ initial, automations: initialAutomations, smsFrom, paypalConfigured, emailEnabled, smsEnabled }: Props) {
  const api = useMarketingApi();
  const { toast } = useToast();
  const onError = useErrorToast();
  const [s, setS] = React.useState<MarketingSettings>(initial);
  const [automations, setAutomations] = React.useState(initialAutomations);
  const [saving, setSaving] = React.useState(false);
  const [newSource, setNewSource] = React.useState("");
  const [busy, setBusy] = React.useState<"pause" | "resume" | null>(null);

  async function save() {
    setSaving(true);
    try {
      const res = await api<{ settings: MarketingSettings }>("/api/admin/marketing/settings", { method: "PUT", json: s });
      setS(res.settings);
      toast({ tone: "success", title: "Settings saved" });
    } catch (e) {
      onError(e, "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function bulkActive(active: boolean) {
    setBusy(active ? "resume" : "pause");
    try {
      const res = await api<{ count: number }>("/api/admin/marketing/automations/bulk-active", { method: "POST", json: { active } });
      const total = automations.active + automations.paused;
      setAutomations(active ? { active: total, paused: 0 } : { active: 0, paused: total });
      toast({ tone: "success", title: active ? `Resumed ${res.count} automations` : `Paused ${res.count} automations` });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Automations"
          subtitle="Master switch. Pausing keeps enrollments in place; steps resume where they left off."
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" iconLeft={<Pause className="h-4 w-4" />} loading={busy === "pause"} onClick={() => bulkActive(false)} disabled={automations.active === 0}>
                Pause all
              </Button>
              <Button size="sm" iconLeft={<Play className="h-4 w-4" />} loading={busy === "resume"} onClick={() => bulkActive(true)} disabled={automations.paused === 0}>
                Resume all
              </Button>
            </div>
          }
        />
        <div className="mt-3 flex gap-2">
          <Badge tone="success">{automations.active} active</Badge>
          <Badge tone="muted">{automations.paused} paused</Badge>
        </div>
      </Card>

      <Card>
        <CardHeader title="Referral rewards" subtitle="What a member earns when someone they refer joins." action={<Toggle checked={s.referral.enabled} onChange={(v) => setS({ ...s, referral: { ...s.referral, enabled: v } })} label="Referral program enabled" />} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select label="Reward type" value={s.referral.rewardKind} onChange={(e) => setS({ ...s, referral: { ...s.referral, rewardKind: e.target.value as "PAYMENT" | "CREDIT" } })}>
            <option value="CREDIT">Account credit</option>
            <option value="PAYMENT">Cash payout (PayPal)</option>
          </Select>
          <Input label="Reward amount ($)" type="number" min={0} step="0.01" value={(s.referral.rewardCents / 100).toFixed(2)} onChange={(e) => setS({ ...s, referral: { ...s.referral, rewardCents: Math.round(Number(e.target.value || 0) * 100) } })} />
          <Input label="Hold period (days)" type="number" min={0} value={s.referral.holdDays} onChange={(e) => setS({ ...s, referral: { ...s.referral, holdDays: Number(e.target.value || 0) } })} hint="Referred member must stay active this long." />
          <div>
            <div className="mb-1.5 text-apple-xs font-medium text-apple-text-secondary">Auto-approve payouts</div>
            <div className="flex items-center gap-2 pt-2">
              <Toggle checked={s.referral.autoApprove} onChange={(v) => setS({ ...s, referral: { ...s.referral, autoApprove: v } })} />
              <span className="text-apple-xs text-apple-text-tertiary">Month-end batches skip manual approval</span>
            </div>
          </div>
        </div>
        <p className="mt-3 text-apple-xs text-apple-text-tertiary">
          PayPal payouts: <Badge tone={paypalConfigured ? "success" : "warn"} size="sm">{paypalConfigured ? "configured" : "not configured (PAYPAL_CLIENT_ID / SECRET)"}</Badge>
        </p>
      </Card>

      <Card>
        <CardHeader title="Acquisition sources" subtitle="Options offered when creating a lead or asking “How did you hear about us?”" />
        <div className="mt-3 flex flex-wrap gap-2">
          {s.sources.map((src) => (
            <span key={src} className="inline-flex items-center gap-1 rounded-full border border-apple-border px-3 py-1 text-apple-xs text-apple-text">
              {src}
              <button type="button" aria-label={`Remove ${src}`} onClick={() => setS({ ...s, sources: s.sources.filter((x) => x !== src) })} className="text-apple-text-tertiary hover:text-apple-red">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <form
          className="mt-3 flex max-w-sm gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = newSource.trim();
            if (v && !s.sources.includes(v)) setS({ ...s, sources: [...s.sources, v] });
            setNewSource("");
          }}
        >
          <Input value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder="Add a source…" />
          <Button type="submit" variant="secondary" iconLeft={<Plus className="h-4 w-4" />}>
            Add
          </Button>
        </form>
      </Card>

      <Card>
        <CardHeader title="Lead stage labels" subtitle="Rename pipeline columns to match how your team talks." />
        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {LEAD_STAGES.map((stage) => (
            <Input key={stage} label={stage} value={s.leadStageLabels[stage]} onChange={(e) => setS({ ...s, leadStageLabels: { ...s.leadStageLabels, [stage]: e.target.value } })} />
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="SMS & compliance" subtitle="Sending number comes from the Quo/OpenPhone integration." />
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-apple-xs font-medium text-apple-text-secondary">Sending number</div>
            <div className="rounded-apple-sm border border-apple-border bg-apple-fill-secondary px-3 py-2.5 font-mono text-apple-sm text-apple-text">{smsFrom ?? "Not configured (OPENPHONE_NUMBER / QUO_NUMBER)"}</div>
            <div className="mt-2 flex gap-2">
              <Badge tone={emailEnabled ? "success" : "danger"} size="sm">Org email {emailEnabled ? "on" : "off"}</Badge>
              <Badge tone={smsEnabled ? "success" : "danger"} size="sm">Org SMS {smsEnabled ? "on" : "off"}</Badge>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-apple-xs font-medium text-apple-text-secondary">Quiet hours (marketing SMS)</div>
            <div className="flex items-center gap-3">
              <Toggle checked={s.quietHours.enabled} onChange={(v) => setS({ ...s, quietHours: { ...s.quietHours, enabled: v } })} />
              <span className="text-apple-sm text-apple-text-secondary">
                No marketing texts {fmtHour(s.quietHours.start)} – {fmtHour(s.quietHours.end)} location time; queued for the next morning.
              </span>
            </div>
            <p className="mt-1 text-apple-xs text-apple-text-tertiary">Window is fixed at 9pm–9am (TCPA safe harbour). Transactional/system SMS are not affected.</p>
          </div>
        </div>
        <div className="mt-4">
          <Textarea label="Compliance text (shown on signup forms and in SMS opt-in)" rows={3} value={s.complianceText} onChange={(e) => setS({ ...s, complianceText: e.target.value })} />
        </div>
      </Card>

      <div className="flex justify-end">
        <Button iconLeft={<Save className="h-4 w-4" />} onClick={save} loading={saving}>
          Save settings
        </Button>
      </div>
    </div>
  );
}

function fmtHour(h: number) {
  const hh = ((h % 24) + 24) % 24;
  const suffix = hh >= 12 ? "pm" : "am";
  const base = hh % 12 === 0 ? 12 : hh % 12;
  return `${base}${suffix}`;
}
