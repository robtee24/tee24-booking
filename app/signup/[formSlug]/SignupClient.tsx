"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card, CardHeader, Input, Money, Select, StatusBadge } from "@/components/ui";
import { Check, ChevronRight } from "lucide-react";

type Plan = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  signupFeeCents: number;
  billingCadence: string;
  productType: string;
  category: string;
};

type FormProps = {
  form: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    defaultPlanId: string | null;
    allowDiscountCode: boolean;
    photoRequired: boolean;
    authSetup: string;
    location: { id: string; name: string; slug: string; organizationId: string | null } | null;
  };
  plans: Plan[];
  utm: { source: string | null; medium: string | null; campaign: string | null; term: string | null; content: string | null };
  referralCode: string | null;
};

type Step = 1 | 2 | 3 | 4;

export function SignupClient({ form, plans, utm, referralCode }: FormProps) {
  const [step, setStep] = useState<Step>(1);
  const [selectedPlanId, setSelectedPlanId] = useState(form.defaultPlanId ?? plans[0]?.id ?? "");
  const [profile, setProfile] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    dob: "",
    addressLine1: "",
    city: "",
    state: "",
    zip: "",
  });
  const [discount, setDiscount] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [emailConsent, setEmailConsent] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = useMemo(() => plans.find((p) => p.id === selectedPlanId), [plans, selectedPlanId]);

  const today = useMemo(() => new Date(), []);

  const total = (plan?.priceCents ?? 0) + (plan?.signupFeeCents ?? 0);

  function set<K extends keyof typeof profile>(k: K, v: (typeof profile)[K]) {
    setProfile((p) => ({ ...p, [k]: v }));
  }

  async function submit() {
    if (!plan) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formSlug: form.slug,
          planId: plan.id,
          ...profile,
          discountCode: discount || null,
          smsConsent,
          emailConsent,
          utm,
          referralCode,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      window.location.href = json.redirectUrl ?? `/portal?welcome=1`;
    } catch (e: any) {
      setError(e.message ?? "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-apple-bg py-10">
      <div className="mx-auto max-w-3xl px-4">
        <header className="mb-6">
          <h1 className="text-apple-3xl font-semibold tracking-tight text-apple-text">{form.name}</h1>
          {form.description && <p className="mt-2 text-apple-base text-apple-text-secondary">{form.description}</p>}
          {form.location && (
            <p className="mt-1 text-apple-sm text-apple-text-tertiary">
              {form.location.name}
            </p>
          )}
        </header>

        {/* Stepper */}
        <ol className="mb-6 flex items-center gap-2 text-apple-xs">
          {(["Plan", "Profile", "Review", "Pay"] as const).map((label, i) => {
            const active = step === (i + 1) as Step;
            const done = step > (i + 1);
            return (
              <li key={label} className="flex items-center gap-2">
                <span className={[
                  "flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-medium",
                  active ? "border-apple-blue bg-apple-blue text-white" :
                  done ? "border-apple-green bg-apple-green text-white" :
                  "border-apple-border bg-white text-apple-text-tertiary",
                ].join(" ")}>
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={active || done ? "font-medium text-apple-text" : "text-apple-text-tertiary"}>{label}</span>
                {i < 3 && <ChevronRight className="h-3 w-3 text-apple-text-tertiary" />}
              </li>
            );
          })}
        </ol>

        {step === 1 && (
          <Card>
            <CardHeader title="Choose a plan" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {plans.map((p) => {
                const selected = selectedPlanId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPlanId(p.id)}
                    className={[
                      "rounded-apple border p-4 text-left transition-colors",
                      selected ? "border-apple-blue bg-apple-blue/5" : "border-apple-border bg-white hover:border-apple-blue/30",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-apple-text">{p.name}</div>
                        {p.description && <div className="mt-1 text-apple-xs text-apple-text-tertiary">{p.description}</div>}
                      </div>
                      <StatusBadge status={p.category} size="sm" />
                    </div>
                    <div className="mt-3 flex items-baseline gap-2">
                      <Money cents={p.priceCents} className="text-apple-xl font-semibold text-apple-text" />
                      <span className="text-apple-xs text-apple-text-tertiary">/ {p.billingCadence.toLowerCase()}</span>
                    </div>
                    {p.signupFeeCents > 0 && (
                      <div className="mt-1 text-apple-xs text-apple-text-tertiary">+ <Money cents={p.signupFeeCents} /> signup fee</div>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-6 flex justify-end">
              <Button disabled={!plan} onClick={() => setStep(2)}>Continue</Button>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardHeader title="Your details" />
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="First name" required value={profile.firstName} onChange={(e) => set("firstName", e.target.value)} />
              <Input label="Last name" required value={profile.lastName} onChange={(e) => set("lastName", e.target.value)} />
              <Input label="Email" type="email" required value={profile.email} onChange={(e) => set("email", e.target.value)} />
              <Input label="Phone" required value={profile.phone} onChange={(e) => set("phone", e.target.value)} />
              <Input label="Date of birth" type="date" value={profile.dob} onChange={(e) => set("dob", e.target.value)} />
              <Input label="Address" value={profile.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} />
              <Input label="City" value={profile.city} onChange={(e) => set("city", e.target.value)} />
              <div className="grid grid-cols-2 gap-4">
                <Input label="State" value={profile.state} onChange={(e) => set("state", e.target.value)} />
                <Input label="ZIP" value={profile.zip} onChange={(e) => set("zip", e.target.value)} />
              </div>
            </div>

            <div className="mt-6 space-y-2 border-t border-apple-divider pt-4 text-apple-sm">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={emailConsent} onChange={(e) => setEmailConsent(e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-apple-blue" />
                <span className="text-apple-text">Email me about classes, news, and offers (you can unsubscribe anytime)</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-apple-blue" />
                <span className="text-apple-text">
                  Text me reminders & marketing offers. Reply STOP to opt out. Msg & data rates may apply. Up to 4 msgs/month.
                  See our <Link href="/privacy" className="text-apple-blue hover:underline">privacy policy</Link>.
                </span>
              </label>
            </div>

            <div className="mt-6 flex justify-between">
              <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)} disabled={!profile.firstName || !profile.lastName || !profile.email || !profile.phone}>
                Continue
              </Button>
            </div>
          </Card>
        )}

        {step === 3 && plan && (
          <Card>
            <CardHeader title="Review" />
            <dl className="mt-4 space-y-2 text-apple-sm">
              <Row label="Plan" value={plan.name} />
              <Row label="Billed" value={`${plan.billingCadence.toLowerCase()}`} />
              <Row label="Price" value={<Money cents={plan.priceCents} />} />
              {plan.signupFeeCents > 0 && <Row label="Signup fee" value={<Money cents={plan.signupFeeCents} />} />}
              <div className="my-2 border-t border-apple-divider"></div>
              <Row label="Today's total" value={<span className="text-apple-lg font-semibold text-apple-text"><Money cents={total} /></span>} />
            </dl>

            {form.allowDiscountCode && (
              <div className="mt-4">
                <Input label="Discount code (optional)" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={() => setStep(4)}>Continue to payment</Button>
            </div>
          </Card>
        )}

        {step === 4 && (
          <Card>
            <CardHeader title="Payment" subtitle="Powered by Square — your card details never touch our servers." />
            <div className="mt-4 rounded-apple-sm border border-dashed border-apple-border bg-apple-fill-secondary p-6 text-center text-apple-sm text-apple-text-secondary">
              Square Web Payments SDK card form goes here. (Phase 1 build — Square SDK script + tokenization wired in next.)
            </div>

            {error && <p className="mt-3 text-apple-sm text-apple-red">{error}</p>}

            <div className="mt-6 flex justify-between">
              <Button variant="secondary" onClick={() => setStep(3)}>Back</Button>
              <Button onClick={submit} loading={submitting}>Complete signup</Button>
            </div>

            <p className="mt-4 text-apple-xs text-apple-text-tertiary">
              By completing signup you agree to the membership terms. Cancellation policy and waiver shown after payment.
            </p>
          </Card>
        )}

        <p className="mt-6 text-center text-apple-xs text-apple-text-tertiary">
          {form.location?.name} · {today.toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-apple-text-secondary">{label}</dt>
      <dd className="font-medium text-apple-text">{value}</dd>
    </div>
  );
}
