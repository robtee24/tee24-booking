"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, Input, PageHeader, Select, Textarea } from "@/components/ui";

type Tag = { id: string; name: string };
type Plan = { id: string; name: string; category: string };
type Template = { id: string; name: string; channel: string; category: string; subject: string | null };

type Props = {
  location: { id: string; name: string; slug: string; organizationId: string | null };
  tags: Tag[];
  plans: Plan[];
  templates: Template[];
};

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active members" },
  { value: "VISITOR", label: "Visitors" },
  { value: "FROZEN", label: "Frozen" },
  { value: "CANCELLED", label: "Cancelled" },
];

export function ComposeClient({ location, tags, plans, templates }: Props) {
  const router = useRouter();

  const [channel, setChannel] = useState<"EMAIL" | "SMS">("EMAIL");
  const [statuses, setStatuses] = useState<string[]>(["ACTIVE"]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [inactiveDays, setInactiveDays] = useState<number | undefined>(undefined);
  const [churnRiskMin, setChurnRiskMin] = useState<number | undefined>(undefined);
  const [templateId, setTemplateId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audienceSize, setAudienceSize] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audience = {
    locationId: location.id,
    organizationId: location.organizationId ?? undefined,
    status: statuses,
    tagIds,
    membershipPlanIds: planIds,
    inactiveDays,
    churnRiskMin,
    channel,
  };

  // Re-compute audience size on filter change (debounced)
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/marketing/messaging?audience=${encodeURIComponent(JSON.stringify(audience))}`,
          { cache: "no-store" }
        );
        if (res.ok) {
          const j = await res.json();
          setAudienceSize(j.size);
        }
      } catch {}
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(audience)]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setSubject(t.subject ?? subject);
    }
  }

  async function send() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/marketing/messaging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience,
          channel,
          templateId: templateId || undefined,
          subject,
          body,
          organizationId: location.organizationId,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const j = await res.json();
      alert(`Sent ${j.sent}/${j.audienceSize}. ${j.failed} failed.`);
      router.push(`/admin/locations/${location.slug}/marketing/messaging`);
    } catch (e: any) {
      setError(e.message ?? "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleArr<T>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Compose broadcast" description={`To members of ${location.name}.`} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Message" />

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select label="Channel" value={channel} onChange={(e) => setChannel(e.target.value as any)}>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
            </Select>
            <div className="sm:col-span-2">
              <Select label="Template (optional)" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">— None —</option>
                {templates
                  .filter((t) => t.channel === channel)
                  .map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
              </Select>
            </div>
          </div>

          {channel === "EMAIL" && (
            <div className="mt-4">
              <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          )}
          <div className="mt-4">
            <Textarea
              label={channel === "EMAIL" ? "Body (HTML or plain)" : "Message"}
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              hint="Use {{firstName}}, {{lastName}}, {{location.name}} as merge fields."
            />
          </div>

          {error && <p className="mt-2 text-apple-sm text-apple-red">{error}</p>}

          <div className="mt-6 flex items-center justify-between">
            <div className="text-apple-sm text-apple-text-secondary">
              Sending to <strong>{audienceSize ?? "—"}</strong> recipient{audienceSize === 1 ? "" : "s"}
            </div>
            <Button onClick={send} loading={submitting} disabled={!body || (channel === "EMAIL" && !subject)}>
              Send now
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Audience" />
          <div className="mt-4 space-y-3">
            <div>
              <div className="mb-1 text-apple-xs uppercase text-apple-text-tertiary">Status</div>
              <div className="flex flex-wrap gap-1">
                {STATUS_OPTIONS.map((s) => {
                  const sel = statuses.includes(s.value);
                  return (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setStatuses(toggleArr(statuses, s.value))}
                      className={`rounded-full border px-3 py-1 text-apple-xs ${
                        sel ? "border-apple-blue bg-apple-blue text-white" : "border-apple-border text-apple-text-secondary"
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-1 text-apple-xs uppercase text-apple-text-tertiary">Tags</div>
              <div className="flex flex-wrap gap-1">
                {tags.length === 0 && <span className="text-apple-xs text-apple-text-tertiary">No tags yet.</span>}
                {tags.map((t) => {
                  const sel = tagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTagIds(toggleArr(tagIds, t.id))}
                      className={`rounded-full border px-3 py-1 text-apple-xs ${
                        sel ? "border-apple-blue bg-apple-blue text-white" : "border-apple-border text-apple-text-secondary"
                      }`}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-1 text-apple-xs uppercase text-apple-text-tertiary">Plan</div>
              <div className="flex flex-wrap gap-1">
                {plans.length === 0 && <span className="text-apple-xs text-apple-text-tertiary">No plans yet.</span>}
                {plans.map((p) => {
                  const sel = planIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlanIds(toggleArr(planIds, p.id))}
                      className={`rounded-full border px-3 py-1 text-apple-xs ${
                        sel ? "border-apple-blue bg-apple-blue text-white" : "border-apple-border text-apple-text-secondary"
                      }`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <Input
              label="At-risk: no visit in N days"
              type="number"
              min={0}
              value={inactiveDays ?? ""}
              onChange={(e) => setInactiveDays(e.target.value ? Number(e.target.value) : undefined)}
            />
            <Input
              label="Churn risk ≥"
              type="number"
              min={0}
              max={100}
              value={churnRiskMin ?? ""}
              onChange={(e) => setChurnRiskMin(e.target.value ? Number(e.target.value) : undefined)}
              hint="0–100. Higher = riskier."
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
