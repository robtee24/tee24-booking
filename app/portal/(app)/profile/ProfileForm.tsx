"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, Input, Select } from "@/components/ui";

export type ProfileDTO = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dob: string | null; // yyyy-mm-dd
  gender: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  guardianName: string | null;
};

export function ProfileForm({ initial, readOnly }: { initial: ProfileDTO; readOnly: boolean }) {
  const router = useRouter();
  const [d, setD] = React.useState({
    ...initial,
    dob: initial.dob ?? "",
    gender: initial.gender ?? "",
    addressLine1: initial.addressLine1 ?? "",
    addressLine2: initial.addressLine2 ?? "",
    city: initial.city ?? "",
    state: initial.state ?? "",
    zip: initial.zip ?? "",
    country: initial.country ?? "US",
    guardianName: initial.guardianName ?? "",
  });
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/portal/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...d, dob: d.dob || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setMsg({ tone: "ok", text: "Profile saved." });
      router.refresh();
    } catch (err: unknown) {
      setMsg({ tone: "err", text: err instanceof Error ? err.message : "Couldn't save" });
    } finally {
      setSaving(false);
    }
  }

  const ro = readOnly ? { disabled: true } : {};

  return (
    <form onSubmit={save} className="space-y-5">
      <Card>
        <CardHeader title="Contact details" subtitle="We use these for receipts, reminders, and door-access notices." />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Input label="First name" value={d.firstName} onChange={(e) => set("firstName", e.target.value)} required autoComplete="given-name" {...ro} />
          <Input label="Last name" value={d.lastName} onChange={(e) => set("lastName", e.target.value)} required autoComplete="family-name" {...ro} />
          <Input label="Email" type="email" value={d.email} onChange={(e) => set("email", e.target.value)} required autoComplete="email" {...ro} />
          <Input label="Mobile phone" type="tel" value={d.phone} onChange={(e) => set("phone", e.target.value)} required autoComplete="tel" hint="Used for sign-in codes and text reminders." {...ro} />
          <Input label="Date of birth" type="date" value={d.dob} onChange={(e) => set("dob", e.target.value)} max={new Date().toISOString().slice(0, 10)} {...ro} />
          <Select label="Gender (optional)" value={d.gender} onChange={(e) => set("gender", e.target.value)} {...ro}>
            <option value="">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="nonbinary">Non-binary</option>
            <option value="other">Other</option>
          </Select>
        </div>
      </Card>

      <Card>
        <CardHeader title="Address" subtitle="Shown on invoices." />
        <div className="mt-4 grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-4"><Input label="Street address" value={d.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} autoComplete="address-line1" {...ro} /></div>
          <div className="sm:col-span-2"><Input label="Apt / suite" value={d.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} autoComplete="address-line2" {...ro} /></div>
          <div className="sm:col-span-3"><Input label="City" value={d.city} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" {...ro} /></div>
          <div className="sm:col-span-1"><Input label="State" value={d.state} onChange={(e) => set("state", e.target.value.toUpperCase())} maxLength={3} autoComplete="address-level1" {...ro} /></div>
          <div className="sm:col-span-2"><Input label="ZIP" value={d.zip} onChange={(e) => set("zip", e.target.value)} autoComplete="postal-code" {...ro} /></div>
          <div className="sm:col-span-3">
            <Select label="Country" value={d.country} onChange={(e) => set("country", e.target.value)} {...ro}>
              <option value="US">United States</option>
              <option value="CA">Canada</option>
              <option value="GB">United Kingdom</option>
              <option value="MX">Mexico</option>
            </Select>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Parent / guardian" subtitle="Required for members under 18." />
        <div className="mt-4">
          <Input label="Guardian full name" value={d.guardianName} onChange={(e) => set("guardianName", e.target.value)} {...ro} />
        </div>
      </Card>

      {msg && <div className={`rounded-apple-sm px-4 py-3 text-apple-sm ${msg.tone === "ok" ? "bg-apple-green/10 text-apple-green" : "bg-apple-red/10 text-apple-red"}`}>{msg.text}</div>}

      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>Save changes</Button>
        </div>
      )}
    </form>
  );
}
