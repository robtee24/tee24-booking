"use client";

import React, { useState } from "react";
import { Button, Card, CardHeader, EmptyState, Input, Money } from "@/components/ui";

type Props = {
  location: { id: string; name: string; slug: string; organizationId: string | null };
  dayPasses: Array<{ id: string; name: string; description: string | null; priceCents: number; durationDays: number }>;
};

export function DayPassClient({ location, dayPasses }: Props) {
  const [planId, setPlanId] = useState(dayPasses[0]?.id ?? "");
  const [profile, setProfile] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [waiverChecked, setWaiverChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = dayPasses.find((p) => p.id === planId);

  function set<K extends keyof typeof profile>(k: K, v: (typeof profile)[K]) {
    setProfile((p) => ({ ...p, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!plan) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/daypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationSlug: location.slug,
          planId: plan.id,
          ...profile,
          waiverAccepted: waiverChecked,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setDone(true);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-apple-bg py-16">
        <div className="mx-auto max-w-md px-4">
          <Card>
            <CardHeader title="You're all set" subtitle="Your day pass is ready." />
            <p className="mt-4 text-apple-sm text-apple-text">
              Check your email and texts for your Kisi door access credential. It's good for the next 24 hours at {location.name}.
            </p>
            <Button onClick={() => (window.location.href = "/")} className="mt-6">Done</Button>
          </Card>
        </div>
      </div>
    );
  }

  if (dayPasses.length === 0) {
    return (
      <div className="min-h-screen bg-apple-bg py-16">
        <div className="mx-auto max-w-md px-4">
          <EmptyState title="No day passes available" description={`${location.name} isn't selling day passes right now.`} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-apple-bg py-12">
      <div className="mx-auto max-w-2xl px-4">
        <header className="mb-6">
          <h1 className="text-apple-2xl font-semibold tracking-tight text-apple-text">Day Pass</h1>
          <p className="mt-1 text-apple-sm text-apple-text-secondary">{location.name}</p>
        </header>

        <form onSubmit={submit} className="space-y-6">
          <Card>
            <CardHeader title="Choose your pass" />
            <div className="mt-4 grid gap-3">
              {dayPasses.map((p) => {
                const sel = planId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlanId(p.id)}
                    className={`rounded-apple border p-4 text-left transition-colors ${
                      sel ? "border-apple-blue bg-apple-blue/5" : "border-apple-border bg-white hover:border-apple-blue/30"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-apple-text">{p.name}</div>
                        {p.description && (
                          <div className="mt-1 text-apple-xs text-apple-text-tertiary">{p.description}</div>
                        )}
                      </div>
                      <Money cents={p.priceCents} className="text-apple-lg font-semibold" />
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title="Your details" />
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="First name" required value={profile.firstName} onChange={(e) => set("firstName", e.target.value)} />
              <Input label="Last name" required value={profile.lastName} onChange={(e) => set("lastName", e.target.value)} />
              <Input label="Email" type="email" required value={profile.email} onChange={(e) => set("email", e.target.value)} />
              <Input label="Phone" required value={profile.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <label className="mt-4 flex items-start gap-2 text-apple-sm">
              <input
                type="checkbox"
                required
                checked={waiverChecked}
                onChange={(e) => setWaiverChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-apple-blue"
              />
              <span className="text-apple-text">
                I have read and accept the facility waiver, terms of use, and assumption of risk.
              </span>
            </label>
          </Card>

          <Card>
            <CardHeader title="Payment" subtitle="Powered by Square. Card details never touch our servers." />
            <div className="mt-4 rounded-apple-sm border border-dashed border-apple-border bg-apple-fill-secondary p-6 text-center text-apple-xs text-apple-text-secondary">
              Square Web Payments SDK card form will mount here.
            </div>
            {error && <p className="mt-3 text-apple-sm text-apple-red">{error}</p>}
            <Button type="submit" loading={submitting} className="mt-4 w-full" disabled={!plan || !waiverChecked}>
              {plan ? <>Pay <Money cents={plan.priceCents} /> &amp; get door access</> : "Select a pass"}
            </Button>
          </Card>
        </form>
      </div>
    </div>
  );
}
