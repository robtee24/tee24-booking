"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui";

export default function NewMemberPage() {
  const params = useParams() as { slug?: string };
  const router = useRouter();
  const slug = params?.slug ?? "";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    dob: "",
    gender: "",
    status: "PENDING",
    membershipType: "",
    optInEmailMarketing: true,
    optInSmsMarketing: false,
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, locationSlug: slug, dob: form.dob || null }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed (${res.status})`);
      }
      const json = await res.json();
      router.push(`/admin/locations/${slug}/members/list/${json.member.id}`);
    } catch (err: any) {
      setError(err.message || "Failed to create member");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Add a member" description="Create a member record manually. Use a signup form for self-serve flows." />

      <form onSubmit={onSubmit}>
        <Card>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="First name" required value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
            <Input label="Last name" required value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
            <Input label="Email" type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} />
            <Input label="Phone" required value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            <Input label="Date of birth" type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} />
            <Select label="Gender" value={form.gender} onChange={(e) => set("gender", e.target.value)}>
              <option value="">Prefer not to say</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="nonbinary">Non-binary</option>
              <option value="other">Other</option>
            </Select>
            <Select label="Status" value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option value="PENDING">Pending (no membership yet)</option>
              <option value="ACTIVE">Active member</option>
              <option value="VISITOR">Visitor</option>
            </Select>
            <Input label="Membership type (label only)" value={form.membershipType} onChange={(e) => set("membershipType", e.target.value)} />
          </div>

          <div className="mt-6 space-y-2 border-t border-apple-divider pt-4">
            <label className="flex items-center gap-2 text-apple-sm text-apple-text">
              <input type="checkbox" checked={form.optInEmailMarketing} onChange={(e) => set("optInEmailMarketing", e.target.checked)} className="h-4 w-4 rounded accent-apple-blue" />
              Opt in to marketing emails
            </label>
            <label className="flex items-center gap-2 text-apple-sm text-apple-text">
              <input type="checkbox" checked={form.optInSmsMarketing} onChange={(e) => set("optInSmsMarketing", e.target.checked)} className="h-4 w-4 rounded accent-apple-blue" />
              Opt in to marketing SMS (TCPA — get explicit consent)
            </label>
          </div>

          {error && <p className="mt-4 text-apple-sm text-apple-red">{error}</p>}

          <div className="mt-6 flex items-center justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => router.back()}>Cancel</Button>
            <Button type="submit" loading={saving}>Create member</Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
