"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card, CardHeader, Input, Money, Select, StatusBadge } from "@/components/ui";
import { CardForm } from "@/components/payments/CardForm";
import type { SquarePublicConfig } from "@/lib/square";
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

type CustomField = { id: string; name: string; type: string; required: boolean; options: string[] | null };

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
    collectTax: boolean;
    requiredFields: string[];
    location: { id: string; name: string; slug: string; organizationId: string | null; taxRateBps: number; cardSurchargeBps: number; currency: string } | null;
  };
  plans: Plan[];
  customFields: CustomField[];
  utm: { source: string | null; medium: string | null; campaign: string | null; term: string | null; content: string | null };
  referralCode: string | null;
  square: SquarePublicConfig;
};

type Step = 1 | 2 | 3 | 4;

type SignupResponse = {
  ok?: boolean;
  error?: string;
  memberId?: string;
  invoiceId?: string;
  payToken?: string;
  payUrl?: string;
  paid?: boolean;
  redirectUrl?: string;
};

const STORAGE_REF_KEY = "tee24:ref";

export function SignupClient({ form, plans, customFields, utm, referralCode: refFromUrl, square }: FormProps) {
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
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [discount, setDiscount] = useState("");
  const [discountPreview, setDiscountPreview] = useState<{ ok: boolean; text: string; amountCents: number } | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [emailConsent, setEmailConsent] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState<SignupResponse | null>(null);

  // Referral code: ?ref= wins, else a previously stored one
  const [referralCode, setReferralCode] = useState<string | null>(refFromUrl);
  React.useEffect(() => {
    try {
      if (refFromUrl) window.localStorage.setItem(STORAGE_REF_KEY, refFromUrl);
      else {
        const stored = window.localStorage.getItem(STORAGE_REF_KEY);
        if (stored) setReferralCode(stored);
      }
    } catch {
      /* storage unavailable */
    }
  }, [refFromUrl]);

  const plan = useMemo(() => plans.find((p) => p.id === selectedPlanId), [plans, selectedPlanId]);
  const today = useMemo(() => new Date(), []);
  const currency = form.location?.currency ?? "USD";

  // Price preview (server is authoritative)
  const totals = useMemo(() => {
    const price = plan?.priceCents ?? 0;
    const fee = plan?.signupFeeCents ?? 0;
    const disc = Math.min(price, discountPreview?.ok ? discountPreview.amountCents : 0);
    const taxable = price + fee - disc;
    const tax = form.collectTax && form.location ? Math.round((taxable * form.location.taxRateBps) / 10_000) : 0;
    const surcharge = square.configured && form.location ? Math.round(((taxable + tax) * form.location.cardSurchargeBps) / 10_000) : 0;
    return { price, fee, disc, tax, surcharge, total: taxable + tax + surcharge };
  }, [plan, discountPreview, form.collectTax, form.location, square.configured]);

  const isRequired = (key: string) => form.requiredFields.includes(key);
  const profileValid =
    !!profile.firstName && !!profile.lastName && !!profile.email && !!profile.phone &&
    (!isRequired("dob") || !!profile.dob) && (!isRequired("addressLine1") || !!profile.addressLine1) &&
    (!isRequired("city") || !!profile.city) && (!isRequired("state") || !!profile.state) && (!isRequired("zip") || !!profile.zip) &&
    customFields.every((f) => !f.required || Boolean(custom[f.id]));

  function set<K extends keyof typeof profile>(k: K, v: (typeof profile)[K]) {
    setProfile((p) => ({ ...p, [k]: v }));
  }

  async function checkCode() {
    if (!discount.trim() || !plan) return;
    setCheckingCode(true);
    try {
      const res = await fetch(`/api/signup?formSlug=${encodeURIComponent(form.slug)}&planId=${encodeURIComponent(plan.id)}&code=${encodeURIComponent(discount.trim())}`);
      const json = await res.json();
      if (json.ok) setDiscountPreview({ ok: true, text: `${json.code}: ${json.description}`, amountCents: json.amountCents ?? 0 });
      else setDiscountPreview({ ok: false, text: json.reason ?? "Invalid code", amountCents: 0 });
    } catch {
      setDiscountPreview({ ok: false, text: "Could not check code", amountCents: 0 });
    } finally {
      setCheckingCode(false);
    }
  }

  async function submit(card?: { sourceId: string; verificationToken: string | null }) {
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
          customFields: custom,
          discountCode: discountPreview?.ok ? discount.trim() : null,
          smsConsent,
          emailConsent,
          utm,
          referralCode,
          sourceId: card?.sourceId ?? null,
          verificationToken: card?.verificationToken ?? null,
        }),
      });
      const json: SignupResponse = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setDeclined(json);
        throw new Error(json.error ?? "Your card was declined");
      }
      if (!res.ok) throw new Error(json.error ?? "Something went wrong");
      try { window.localStorage.removeItem(STORAGE_REF_KEY); } catch { /* noop */ }
      window.location.href = json.redirectUrl ?? `/portal?welcome=1`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      throw e;
    } finally {
      setSubmitting(false);
    }
  }

  /** After a decline, retry with another card against the hosted pay token (member already exists). */
  async function retryPayment(card: { sourceId: string; verificationToken: string | null }) {
    if (!declined?.payToken) return;
    setError(null);
    const res = await fetch(`/api/pay/${encodeURIComponent(declined.payToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: card.sourceId, verificationToken: card.verificationToken }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Payment failed");
    window.location.href = declined.redirectUrl ?? `/portal?welcome=1`;
  }

  const billingContact = {
    givenName: profile.firstName,
    familyName: profile.lastName,
    email: profile.email,
    phone: profile.phone,
    addressLines: profile.addressLine1 ? [profile.addressLine1] : undefined,
    city: profile.city || undefined,
    state: profile.state || undefined,
    postalCode: profile.zip || undefined,
    countryCode: "US",
  };

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
                    onClick={() => { setSelectedPlanId(p.id); setDiscountPreview(null); }}
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
                      <Money cents={p.priceCents} currency={currency} className="text-apple-xl font-semibold text-apple-text" />
                      <span className="text-apple-xs text-apple-text-tertiary">/ {p.billingCadence.toLowerCase()}</span>
                    </div>
                    {p.signupFeeCents > 0 && (
                      <div className="mt-1 text-apple-xs text-apple-text-tertiary">+ <Money cents={p.signupFeeCents} currency={currency} /> signup fee</div>
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
              <Input label={`Date of birth${isRequired("dob") ? "" : " (optional)"}`} type="date" required={isRequired("dob")} value={profile.dob} onChange={(e) => set("dob", e.target.value)} />
              <Input label={`Address${isRequired("addressLine1") ? "" : " (optional)"}`} required={isRequired("addressLine1")} value={profile.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} />
              <Input label="City" required={isRequired("city")} value={profile.city} onChange={(e) => set("city", e.target.value)} />
              <div className="grid grid-cols-2 gap-4">
                <Input label="State" required={isRequired("state")} value={profile.state} onChange={(e) => set("state", e.target.value)} />
                <Input label="ZIP" required={isRequired("zip")} value={profile.zip} onChange={(e) => set("zip", e.target.value)} />
              </div>
              {customFields.map((f) => (
                <CustomFieldInput key={f.id} field={f} value={custom[f.id] ?? ""} onChange={(v) => setCustom((c) => ({ ...c, [f.id]: v }))} />
              ))}
            </div>
            {form.photoRequired && (
              <p className="mt-3 text-apple-xs text-apple-text-tertiary">A profile photo is required for this membership — the front desk will take one on your first visit.</p>
            )}

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
              <Button onClick={() => setStep(3)} disabled={!profileValid}>
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
              <Row label="Price" value={<Money cents={plan.priceCents} currency={currency} />} />
              {plan.signupFeeCents > 0 && <Row label="Signup fee" value={<Money cents={plan.signupFeeCents} currency={currency} />} />}
              {totals.disc > 0 && <Row label="Discount" value={<span className="text-apple-green">−<Money cents={totals.disc} currency={currency} /></span>} />}
              {totals.tax > 0 && <Row label="Tax" value={<Money cents={totals.tax} currency={currency} />} />}
              {totals.surcharge > 0 && <Row label="Card surcharge" value={<Money cents={totals.surcharge} currency={currency} />} />}
              <div className="my-2 border-t border-apple-divider"></div>
              <Row label="Today's total" value={<span className="text-apple-lg font-semibold text-apple-text"><Money cents={totals.total} currency={currency} /></span>} />
              {referralCode && <Row label="Referred by" value={<span className="font-mono text-apple-xs">{referralCode}</span>} />}
            </dl>

            {form.allowDiscountCode && (
              <div className="mt-4">
                <div className="flex items-end gap-2">
                  <Input label="Discount code (optional)" value={discount} onChange={(e) => { setDiscount(e.target.value.toUpperCase()); setDiscountPreview(null); }} />
                  <Button variant="secondary" onClick={checkCode} loading={checkingCode} disabled={!discount.trim()}>Apply</Button>
                </div>
                {discountPreview && <p className={`mt-1 text-apple-xs ${discountPreview.ok ? "text-apple-green" : "text-apple-red"}`}>{discountPreview.text}</p>}
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={() => setStep(4)}>{square.configured ? "Continue to payment" : "Continue"}</Button>
            </div>
          </Card>
        )}

        {step === 4 && plan && (
          <Card>
            <CardHeader
              title="Payment"
              subtitle={square.configured ? "Powered by Square — your card details never touch our servers." : "Complete your signup now and pay at the front desk on your first visit."}
            />

            {declined?.payToken ? (
              <div className="mt-4 space-y-3">
                <p className="rounded-apple-sm border border-apple-red/30 bg-apple-red/5 p-3 text-apple-sm text-apple-red">{error ?? declined.error}</p>
                <p className="text-apple-sm text-apple-text-secondary">Your account was created. Try another card to activate your membership, or pay later using the link we emailed you.</p>
                <CardForm square={square} intent="CHARGE" amountCents={totals.total} currency={currency} billingContact={billingContact} onToken={retryPayment} buttonLabel={<>Pay <Money cents={totals.total} currency={currency} /></>} />
                <Button variant="link" onClick={() => (window.location.href = declined.redirectUrl ?? "/portal")}>Skip for now</Button>
              </div>
            ) : square.configured ? (
              <div className="mt-4">
                <CardForm
                  square={square}
                  intent="CHARGE"
                  amountCents={totals.total}
                  currency={currency}
                  billingContact={billingContact}
                  submitting={submitting}
                  onToken={(card) => submit(card)}
                  buttonLabel={<>Pay <Money cents={totals.total} currency={currency} /> &amp; join</>}
                >
                  <p className="text-apple-xs text-apple-text-tertiary">
                    Your card is saved securely with Square and charged <Money cents={plan.priceCents} currency={currency} /> every {plan.billingCadence.toLowerCase().replace("ly", "")} until you cancel.
                  </p>
                </CardForm>
                {error && <p className="mt-3 text-apple-sm text-apple-red">{error}</p>}
              </div>
            ) : (
              <>
                <div className="mt-4 rounded-apple-sm border border-apple-border bg-apple-fill-secondary p-4 text-apple-sm text-apple-text-secondary">
                  Online payments aren&apos;t available yet. We&apos;ll create your account now and the front desk will collect <Money cents={totals.total} currency={currency} /> to activate your membership.
                </div>
                {error && <p className="mt-3 text-apple-sm text-apple-red">{error}</p>}
                <div className="mt-6 flex justify-between">
                  <Button variant="secondary" onClick={() => setStep(3)}>Back</Button>
                  <Button onClick={() => submit().catch(() => {})} loading={submitting}>Complete signup</Button>
                </div>
              </>
            )}

            {!declined && square.configured && (
              <div className="mt-4">
                <Button variant="secondary" onClick={() => setStep(3)} disabled={submitting}>Back</Button>
              </div>
            )}

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

function CustomFieldInput({ field, value, onChange }: { field: CustomField; value: string; onChange: (v: string) => void }) {
  const label = `${field.name}${field.required ? "" : " (optional)"}`;
  if (field.type === "SELECT" && field.options) {
    return (
      <Select label={label} required={field.required} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    );
  }
  if (field.type === "BOOLEAN") {
    return (
      <label className="flex items-center gap-2 pt-6 text-apple-sm text-apple-text">
        <input type="checkbox" checked={value === "true"} onChange={(e) => onChange(e.target.checked ? "true" : "")} className="h-4 w-4 rounded accent-apple-blue" />
        {label}
      </label>
    );
  }
  const type = field.type === "NUMBER" ? "number" : field.type === "DATE" ? "date" : "text";
  return <Input label={label} type={type} required={field.required} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-apple-text-secondary">{label}</dt>
      <dd className="font-medium text-apple-text">{value}</dd>
    </div>
  );
}
