"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Mail, MessageSquare } from "lucide-react";
import { Button, Card, CardHeader, Input, Select, Textarea, useToast } from "@/components/ui";
import { Toggle } from "@/components/admin/location-settings/SettingsSection";

export type OrgDTO = {
  id: string;
  name: string;
  slug: string;
  brandColor: string | null;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  defaultTimezone: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  bccEmail: string | null;
  replyToEmail: string | null;
  emailFooter: string | null;
  updatedAt: string;
};

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
];

export function OrgSettingsForm({ org }: { org: OrgDTO }) {
  const router = useRouter();
  const { toast } = useToast();
  const [d, setD] = React.useState({
    name: org.name,
    brandColor: org.brandColor ?? "#0071e3",
    logoUrl: org.logoUrl ?? "",
    contactEmail: org.contactEmail ?? "",
    contactPhone: org.contactPhone ?? "",
    defaultTimezone: org.defaultTimezone,
    emailEnabled: org.emailEnabled,
    smsEnabled: org.smsEnabled,
    bccEmail: org.bccEmail ?? "",
    replyToEmail: org.replyToEmail ?? "",
    emailFooter: org.emailFooter ?? "",
  });
  const [saving, setSaving] = React.useState<string | null>(null);
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((p) => ({ ...p, [k]: v }));

  async function patch(payload: Record<string, unknown>, label: string) {
    setSaving(label);
    try {
      const res = await fetch("/api/admin/org-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      toast({ tone: "success", title: `${label} saved` });
      router.refresh();
    } catch (e: unknown) {
      toast({ tone: "error", title: `Couldn't save ${label.toLowerCase()}`, description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(null);
    }
  }

  async function toggleChannel(key: "emailEnabled" | "smsEnabled", value: boolean) {
    set(key, value);
    await patch({ [key]: value }, key === "emailEnabled" ? "Email switch" : "SMS switch");
  }

  return (
    <div className="space-y-6">
      {(!d.emailEnabled || !d.smsEnabled) && (
        <div className="flex items-start gap-3 rounded-apple border border-apple-orange/30 bg-apple-orange/5 p-4 text-apple-sm text-apple-orange">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <span className="font-semibold">Outbound {[!d.emailEnabled && "email", !d.smsEnabled && "SMS"].filter(Boolean).join(" and ")} is paused.</span>{" "}
            Members will not receive receipts, reminders, waivers, or campaigns on the paused channel until it&apos;s re-enabled.
          </div>
        </div>
      )}

      <Card>
        <CardHeader title="Delivery switches" subtitle="Global kill switches. Flip off during an incident, a provider outage, or a bulk-import to avoid accidental sends." />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-apple-sm border border-apple-border p-4">
            <div className="mb-3 flex items-center gap-2 text-apple-sm font-semibold text-apple-text">
              <Mail className="h-4 w-4 text-apple-blue" /> Email
            </div>
            <Toggle checked={d.emailEnabled} onChange={(v) => void toggleChannel("emailEnabled", v)} label={d.emailEnabled ? "Email sending is ON" : "Email sending is OFF"} hint="Applies to transactional and marketing email." />
          </div>
          <div className="rounded-apple-sm border border-apple-border p-4">
            <div className="mb-3 flex items-center gap-2 text-apple-sm font-semibold text-apple-text">
              <MessageSquare className="h-4 w-4 text-apple-green" /> SMS
            </div>
            <Toggle checked={d.smsEnabled} onChange={(v) => void toggleChannel("smsEnabled", v)} label={d.smsEnabled ? "SMS sending is ON" : "SMS sending is OFF"} hint="Admin login codes are always delivered." />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Email defaults" subtitle="Applied to every outbound email." />
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void patch({ replyToEmail: d.replyToEmail, bccEmail: d.bccEmail, emailFooter: d.emailFooter }, "Email defaults");
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Reply-to address" type="email" value={d.replyToEmail} onChange={(e) => set("replyToEmail", e.target.value)} placeholder="hello@tee24.golf" hint="Where member replies land." />
            <Input label="BCC address" type="email" value={d.bccEmail} onChange={(e) => set("bccEmail", e.target.value)} placeholder="records@tee24.golf" hint="Silent copy of every email (compliance / CRM)." />
          </div>
          <Textarea
            label="Email footer"
            rows={5}
            value={d.emailFooter}
            onChange={(e) => set("emailFooter", e.target.value)}
            placeholder={"Tee24 Golf · 123 Fairway Dr, Clarksville TN 37040\nYou're receiving this because you're a Tee24 member. Reply STOP to unsubscribe from texts."}
            hint="Appended to every email. Include your mailing address for CAN-SPAM. Plain text or simple HTML."
          />
          <div className="flex justify-end">
            <Button type="submit" loading={saving === "Email defaults"}>Save email defaults</Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Organization identity" subtitle="Name, brand color, logo, and contact details shown in emails and the member portal." />
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void patch(
              { name: d.name, brandColor: d.brandColor, logoUrl: d.logoUrl, contactEmail: d.contactEmail, contactPhone: d.contactPhone, defaultTimezone: d.defaultTimezone },
              "Organization",
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Organization name" value={d.name} onChange={(e) => set("name", e.target.value)} required />
            <div>
              <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Brand color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(d.brandColor) ? d.brandColor : "#0071e3"} onChange={(e) => set("brandColor", e.target.value)} className="h-10 w-12 cursor-pointer rounded-apple-sm border border-apple-border bg-white p-1" aria-label="Brand color picker" />
                <Input value={d.brandColor} onChange={(e) => set("brandColor", e.target.value)} placeholder="#0071e3" className="font-mono" />
              </div>
            </div>
            <Input label="Logo URL" type="url" value={d.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://…/logo.png" className="font-mono" />
            <Select label="Default timezone" value={d.defaultTimezone} onChange={(e) => set("defaultTimezone", e.target.value)} hint="New locations start with this zone.">
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              {!TIMEZONES.includes(d.defaultTimezone) && <option value={d.defaultTimezone}>{d.defaultTimezone}</option>}
            </Select>
            <Input label="Contact email" type="email" value={d.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} placeholder="hello@tee24.golf" />
            <Input label="Contact phone" type="tel" value={d.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} placeholder="+1 (931) 555-0100" className="font-mono" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={saving === "Organization"}>Save organization</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
