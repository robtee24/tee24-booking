"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, CardHeader, Input, PageHeader, Select, Textarea } from "@/components/ui";

export default function NewMembershipPage() {
  const params = useParams() as { slug?: string };
  const router = useRouter();
  const slug = params?.slug ?? "";

  const [form, setForm] = useState({
    name: "",
    description: "",
    productType: "RECURRING",
    category: "MEMBER",
    signupFee: "0",
    price: "0",
    billingCadence: "MONTHLY",
    durationDays: "",
    familyBundle: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/memberships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationSlug: slug,
          name: form.name,
          description: form.description || null,
          productType: form.productType,
          category: form.category,
          priceCents: Math.round(Number(form.price) * 100) || 0,
          signupFeeCents: Math.round(Number(form.signupFee) * 100) || 0,
          billingCadence: form.billingCadence,
          durationDays: form.durationDays ? Number(form.durationDays) : null,
          familyBundle: form.familyBundle,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.push(`/admin/locations/${slug}/members/memberships`);
    } catch (err: any) {
      setError(err.message || "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="New membership plan" description="Set pricing, billing, and category." />

      <form onSubmit={onSubmit}>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Basics" />
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Plan name" required value={form.name} onChange={(e) => set("name", e.target.value)} />
              <Select label="Product type" value={form.productType} onChange={(e) => set("productType", e.target.value)}>
                <option value="RECURRING">Recurring membership</option>
                <option value="ONE_OFF">One-off (e.g. annual)</option>
                <option value="DAY_PASS">Day pass</option>
                <option value="PUNCH_CARD">Punch card</option>
                <option value="BUNDLE">Bundle</option>
                <option value="COMP">Comp / sponsored</option>
              </Select>
              <Select label="Category" value={form.category} onChange={(e) => set("category", e.target.value)}>
                <option value="MEMBER">Member</option>
                <option value="VISITOR">Visitor</option>
              </Select>
              <Textarea label="Description" rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Pricing" />
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input label="Price ($)" type="number" min="0" step="0.01" value={form.price} onChange={(e) => set("price", e.target.value)} />
              <Input label="Signup fee ($)" type="number" min="0" step="0.01" value={form.signupFee} onChange={(e) => set("signupFee", e.target.value)} />
              <Select label="Billing cadence" value={form.billingCadence} onChange={(e) => set("billingCadence", e.target.value)}>
                <option value="MONTHLY">Monthly</option>
                <option value="YEARLY">Yearly</option>
                <option value="WEEKLY">Weekly</option>
                <option value="ONE_OFF">One-off</option>
              </Select>
              <Input
                label="Duration (days, optional)"
                type="number"
                min="0"
                value={form.durationDays}
                onChange={(e) => set("durationDays", e.target.value)}
                hint="For day passes / fixed-term plans"
              />
            </div>
            <div className="mt-3">
              <label className="flex items-center gap-2 text-apple-sm text-apple-text">
                <input type="checkbox" checked={form.familyBundle} onChange={(e) => set("familyBundle", e.target.checked)} className="h-4 w-4 rounded accent-apple-blue" />
                Family bundle
              </label>
            </div>
          </Card>

          {error && <p className="text-apple-sm text-apple-red">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => router.back()}>Cancel</Button>
            <Button type="submit" loading={saving}>Create plan</Button>
          </div>
        </div>
      </form>
    </div>
  );
}
