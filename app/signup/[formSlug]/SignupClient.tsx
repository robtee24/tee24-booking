"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card, CardHeader, Input, Money, Select } from "@/components/ui";
import { CardForm } from "@/components/payments/CardForm";
import { SignaturePad, type SignaturePadHandle } from "@/components/portal/SignaturePad";
import type { SquarePublicConfig } from "@/lib/square";
import { BadgePercent, Camera, Check, ChevronRight, FileCheck, RefreshCw, ShieldCheck, Upload, Users } from "lucide-react";
import { guestCentsFor, guestIncrementCents, maxGuestsFor, membershipDisplayName, type SignupPromo } from "@/lib/membership-pricing";

type Plan = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  signupFeeCents: number;
  billingCadence: string;
  productType: string;
  category: string;
  durationDays: number | null;
  guestAddonCents: number | null;
  maxGuests: number;
  dayPassGuestPricing: unknown;
  visitsPerPeriod: number | null;
};

type CustomField = { id: string; name: string; type: string; required: boolean; options: string[] | null };
type SignupDocument = { id: string; name: string; description: string | null; bodyHtml: string; version: number };

type FormProps = {
  form: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    defaultPlanId: string | null;
    allowDiscountCode: boolean;
    photoRequired: boolean;
    collectTax: boolean;
    requiredFields: string[];
    emergencyContactMode: "hidden" | "optional" | "required";
    location: { id: string; name: string; slug: string; organizationId: string | null; taxRateBps: number; cardSurchargeBps: number; currency: string } | null;
  };
  plans: Plan[];
  promos: SignupPromo[];
  customFields: CustomField[];
  documents: SignupDocument[];
  utm: { source: string | null; medium: string | null; campaign: string | null; term: string | null; content: string | null };
  referralCode: string | null;
  square: SquarePublicConfig;
  /** Served from /signup-staging: allow unpublished forms on the API as well. */
  staging?: boolean;
};

type Step = 1 | 2 | 3;

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

type PhoneState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent"; expiresAt: number; sentAt: number }
  | { status: "verifying"; expiresAt: number; sentAt: number }
  | { status: "verified"; phone: string; token: string };

const STORAGE_REF_KEY = "tee24:ref";
const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

function digitsOnly(v: string) {
  return v.replace(/\D/g, "");
}
function formatPhone(v: string) {
  const d = digitsOnly(v).replace(/^1(?=\d{10})/, "").slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
function ageFromDob(dob: string): number | null {
  if (!dob) return null;
  const d = new Date(dob + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}
function cadenceLabel(p: Plan) {
  if (p.productType === "DAY_PASS") return p.durationDays && p.durationDays > 1 ? `${p.durationDays}-day pass` : "day pass";
  if (p.productType === "PUNCH_CARD") return "one-time";
  if (p.billingCadence === "ONE_OFF") return p.durationDays ? `${p.durationDays} days` : "one-time";
  return `/ ${p.billingCadence.toLowerCase()}`;
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Downscale a camera/gallery image to a small JPEG data URL before upload. */
async function fileToPhotoDataUrl(file: File, max = 640): Promise<string> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read that image"));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = "width" in source ? source.width : 0;
  const h = "height" in source ? source.height : 0;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process image");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Read an ID photo / PDF as a data URL (images are downscaled, PDFs sent as-is). */
async function fileToUploadDataUrl(file: File): Promise<string> {
  if (file.type === "application/pdf") {
    if (file.size > 6 * 1024 * 1024) throw new Error("PDF must be under 6 MB");
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Could not read that file"));
      r.readAsDataURL(file);
    });
  }
  return fileToPhotoDataUrl(file, 1600);
}

export function SignupClient({ form, plans, promos, customFields, documents, utm, referralCode: refFromUrl, square, staging = false }: FormProps) {
  const stagingQs = staging ? "&staging=1" : "";
  const [step, setStep] = useState<Step>(1);
  const [selectedPlanId, setSelectedPlanId] = useState(form.defaultPlanId ?? plans[0]?.id ?? "");
  const [guestCount, setGuestCount] = useState(0);
  // Signup promotion (mutually exclusive with a discount code)
  const [promoId, setPromoId] = useState<string | null>(null);
  const [promoPreview, setPromoPreview] = useState<{ ok: boolean; text: string; amountCents: number } | null>(null);
  const [promoIdFile, setPromoIdFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [promoIdBusy, setPromoIdBusy] = useState(false);
  const [promoIdError, setPromoIdError] = useState<string | null>(null);
  const [promoAck, setPromoAck] = useState(false);
  const promoIdInputRef = React.useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    dob: "",
    gender: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    zip: "",
  });
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [ec, setEc] = useState({ name: "", phone: "", relationship: "" });
  const [discount, setDiscount] = useState("");
  const [discountPreview, setDiscountPreview] = useState<{ ok: boolean; text: string; amountCents: number } | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [emailConsent, setEmailConsent] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState<SignupResponse | null>(null);

  // Phone verification
  const [phoneState, setPhoneState] = useState<PhoneState>({ status: "idle" });
  const [otpCode, setOtpCode] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  React.useEffect(() => {
    if (phoneState.status !== "sent" && phoneState.status !== "verifying") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phoneState.status]);

  // Photo
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoInputRef = React.useRef<HTMLInputElement>(null);

  // Waivers
  const sigRefs = React.useRef<Record<string, SignaturePadHandle | null>>({});
  const guardianRef = React.useRef<SignaturePadHandle | null>(null);
  const [sigEmpty, setSigEmpty] = useState<Record<string, boolean>>(() => Object.fromEntries(documents.map((d) => [d.id, true])));
  const [guardianEmpty, setGuardianEmpty] = useState(true);
  const [guardianName, setGuardianName] = useState("");
  const [agree, setAgree] = useState(false);

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
  const currency = form.location?.currency ?? "USD";
  const maxGuests = plan ? maxGuestsFor(plan) : 0;
  const isDayPass = plan?.productType === "DAY_PASS";
  const displayName = plan ? membershipDisplayName(plan.name, isDayPass ? 0 : guestCount) : "";
  const eligiblePromos = useMemo(() => (plan ? promos.filter((pr) => pr.planIds.length === 0 || pr.planIds.includes(plan.id)) : []), [promos, plan]);
  const promo = eligiblePromos.find((pr) => pr.id === promoId) ?? null;
  const promoNeedsId = !!promo?.requiresIdUpload;
  const promoNeedsAck = !!(promo?.commitmentMonths && promo.commitmentAcknowledgement);
  const promoOk = !promo || ((!promoNeedsId || !!promoIdFile) && (!promoNeedsAck || promoAck));

  // Server-authoritative preview of the selected promotion for this plan + guest count
  React.useEffect(() => {
    if (!promo || !plan) { setPromoPreview(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/signup?formSlug=${encodeURIComponent(form.slug)}&planId=${encodeURIComponent(plan.id)}&guestCount=${guestCount}&promoId=${encodeURIComponent(promo.id)}${stagingQs}`);
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) setPromoPreview({ ok: true, text: json.description, amountCents: json.amountCents ?? 0 });
        else setPromoPreview({ ok: false, text: json.reason ?? "This promotion isn't available", amountCents: 0 });
      } catch {
        if (!cancelled) setPromoPreview({ ok: false, text: "Could not load promotion", amountCents: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [promo, plan, guestCount, form.slug]);

  function choosePlan(id: string) {
    const next = plans.find((p) => p.id === id);
    setSelectedPlanId(id);
    setDiscountPreview(null);
    setGuestCount((g) => Math.min(g, next ? maxGuestsFor(next) : 0));
    const stillEligible = promoId && promos.some((pr) => pr.id === promoId && (pr.planIds.length === 0 || (next && pr.planIds.includes(next.id))));
    if (!stillEligible) { setPromoId(null); setPromoAck(false); }
  }
  function choosePromo(id: string | null) {
    setPromoId((cur) => (cur === id ? null : id));
    setPromoAck(false);
    setPromoIdError(null);
    if (id) { setDiscount(""); setDiscountPreview(null); }
  }
  async function onPromoIdPicked(file: File | null) {
    if (!file) return;
    setPromoIdBusy(true);
    setPromoIdError(null);
    try {
      setPromoIdFile({ name: file.name, dataUrl: await fileToUploadDataUrl(file) });
    } catch (e) {
      setPromoIdError(e instanceof Error ? e.message : "Could not read that file");
    } finally {
      setPromoIdBusy(false);
      if (promoIdInputRef.current) promoIdInputRef.current.value = "";
    }
  }
  const isRequired = (key: string) => form.requiredFields.includes(key);
  const age = ageFromDob(profile.dob);
  const isMinor = age !== null && age < 18;

  const groups = useMemo(() => {
    const memberships = plans.filter((p) => p.productType === "RECURRING" || (p.productType === "ONE_OFF" && p.category !== "VISITOR"));
    const passes = plans.filter((p) => p.productType === "DAY_PASS" || p.productType === "COMP" || (p.productType === "ONE_OFF" && p.category === "VISITOR"));
    const packs = plans.filter((p) => p.productType === "PUNCH_CARD");
    const seen = new Set([...memberships, ...passes, ...packs].map((p) => p.id));
    const other = plans.filter((p) => !seen.has(p.id));
    return [
      { label: "Memberships", items: memberships },
      { label: "Passes", items: passes },
      { label: "Lessons & packs", items: [...packs, ...other] },
    ].filter((g) => g.items.length > 0);
  }, [plans]);

  // Price preview (server is authoritative)
  const totals = useMemo(() => {
    const base = plan?.priceCents ?? 0;
    const guests = plan ? guestCentsFor(plan, guestCount) : 0;
    const price = base + guests;
    const fee = plan?.signupFeeCents ?? 0;
    const discAmount = promo ? (promoPreview?.ok ? promoPreview.amountCents : 0) : discountPreview?.ok ? discountPreview.amountCents : 0;
    const disc = Math.min(price, discAmount);
    const taxable = price + fee - disc;
    const tax = form.collectTax && form.location ? Math.round((taxable * form.location.taxRateBps) / 10_000) : 0;
    const surcharge = square.configured && form.location ? Math.round(((taxable + tax) * form.location.cardSurchargeBps) / 10_000) : 0;
    return { base, guests, price, fee, disc, tax, surcharge, total: taxable + tax + surcharge };
  }, [plan, guestCount, promo, promoPreview, discountPreview, form.collectTax, form.location, square.configured]);

  const phoneVerified = phoneState.status === "verified";
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim());
  const addressOk = !!profile.addressLine1.trim() && !!profile.city.trim() && !!profile.state && /^\d{5}(-\d{4})?$/.test(profile.zip.trim());
  const photoOk = !!photo || !(isRequired("photo") || form.photoRequired);
  const ecOk = form.emergencyContactMode !== "required" || (!!ec.name.trim() && digitsOnly(ec.phone).length === 10);
  const docsOk = documents.every((d) => !sigEmpty[d.id]) && (!isMinor || (!!guardianName.trim() && !guardianEmpty)) && (documents.length === 0 || agree);
  const profileValid =
    !!profile.firstName.trim() && !!profile.lastName.trim() && emailOk && phoneVerified &&
    !!profile.dob && age !== null && age >= 0 && age < 120 && !!profile.gender &&
    addressOk && photoOk && docsOk && ecOk &&
    customFields.every((f) => !f.required || Boolean(custom[f.id]));

  function set<K extends keyof typeof profile>(k: K, v: (typeof profile)[K]) {
    setProfile((p) => ({ ...p, [k]: v }));
  }

  function onPhoneChange(v: string) {
    const formatted = formatPhone(v);
    set("phone", formatted);
    if (phoneState.status !== "idle") {
      setPhoneState({ status: "idle" });
      setOtpCode("");
    }
    setPhoneError(null);
  }

  async function sendCode() {
    if (digitsOnly(profile.phone).length !== 10) {
      setPhoneError("Enter a 10-digit US mobile number.");
      return;
    }
    setPhoneError(null);
    setPhoneState({ status: "sending" });
    try {
      const res = await fetch("/api/signup/phone/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: profile.phone }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not send code");
      setPhoneState({ status: "sent", expiresAt: json.expiresAt ?? Date.now() + 5 * 60_000, sentAt: Date.now() });
      setOtpCode("");
    } catch (e) {
      setPhoneState({ status: "idle" });
      setPhoneError(e instanceof Error ? e.message : "Could not send code");
    }
  }

  async function verifyCode(code = otpCode) {
    if (phoneState.status !== "sent" || !/^\d{6}$/.test(code)) return;
    const prev = phoneState;
    setPhoneState({ status: "verifying", expiresAt: prev.expiresAt, sentAt: prev.sentAt });
    setPhoneError(null);
    try {
      const res = await fetch("/api/signup/phone/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: profile.phone, code }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Invalid code");
      setPhoneState({ status: "verified", phone: json.phone, token: json.phoneToken });
    } catch (e) {
      setPhoneState(prev);
      setPhoneError(e instanceof Error ? e.message : "Invalid code");
    }
  }

  async function onPhotoPicked(file: File | null) {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      setPhoto(await fileToPhotoDataUrl(file));
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Could not read that photo");
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  async function checkCode() {
    if (!discount.trim() || !plan) return;
    setCheckingCode(true);
    try {
      const res = await fetch(`/api/signup?formSlug=${encodeURIComponent(form.slug)}&planId=${encodeURIComponent(plan.id)}&guestCount=${guestCount}&code=${encodeURIComponent(discount.trim())}${stagingQs}`);
      const json = await res.json();
      if (json.ok) { setDiscountPreview({ ok: true, text: `${json.code}: ${json.description}`, amountCents: json.amountCents ?? 0 }); setPromoId(null); setPromoAck(false); }
      else setDiscountPreview({ ok: false, text: json.reason ?? "Invalid code", amountCents: 0 });
    } catch {
      setDiscountPreview({ ok: false, text: "Could not check code", amountCents: 0 });
    } finally {
      setCheckingCode(false);
    }
  }

  function collectSignatures() {
    const signatures = documents.map((d) => {
      const pad = sigRefs.current[d.id];
      const svg = pad?.toSvgDataUrl() ?? pad?.toDataUrl() ?? null;
      return { documentId: d.id, signatureSvg: svg };
    });
    const guardian = isMinor ? { name: guardianName.trim(), signatureSvg: guardianRef.current?.toSvgDataUrl() ?? guardianRef.current?.toDataUrl() ?? null } : null;
    return { signatures, guardian };
  }
  // Signature pads unmount when leaving step 2, so capture their strokes on the way out.
  const [captured, setCaptured] = useState<ReturnType<typeof collectSignatures> | null>(null);
  function goToPayment() {
    setCaptured(collectSignatures());
    setStep(3);
  }
  /** Pads remount blank when coming back, so signatures must be redrawn. */
  function backToDetails() {
    setSigEmpty(Object.fromEntries(documents.map((d) => [d.id, true])));
    setGuardianEmpty(true);
    setCaptured(null);
    setStep(2);
  }

  async function submit(card?: { sourceId: string; verificationToken: string | null }) {
    if (!plan || phoneState.status !== "verified") return;
    setSubmitting(true);
    setError(null);
    try {
      const sigs = captured ?? collectSignatures();
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formSlug: form.slug,
          planId: plan.id,
          staging,
          ...profile,
          phone: phoneState.phone,
          phoneToken: phoneState.token,
          photoDataUrl: photo,
          signatures: sigs.signatures,
          guardian: sigs.guardian,
          customFields: custom,
          emergencyContact: ec.name.trim() ? ec : null,
          discountCode: !promo && discountPreview?.ok ? discount.trim() : null,
          guestCount: maxGuests > 0 ? guestCount : 0,
          promoDiscountId: promo?.id ?? null,
          promoIdDataUrl: promo?.requiresIdUpload ? promoIdFile?.dataUrl ?? null : null,
          promoAcknowledged: promo ? promoAck : false,
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
    phone: phoneState.status === "verified" ? phoneState.phone : profile.phone,
    addressLines: [profile.addressLine1, profile.addressLine2].filter(Boolean),
    city: profile.city || undefined,
    state: profile.state || undefined,
    postalCode: profile.zip || undefined,
    countryCode: "US",
  };

  // Merge fields inside waiver HTML ({{name}} / {name}) filled live from the form
  const mergeVars = useMemo(() => {
    const fullName = `${profile.firstName} ${profile.lastName}`.trim();
    const today = new Date().toLocaleDateString();
    return {
      firstName: profile.firstName, lastName: profile.lastName, fullName, memberName: fullName, name: fullName,
      email: profile.email, phone: profile.phone, dob: profile.dob ? new Date(profile.dob + "T00:00:00").toLocaleDateString() : "",
      address: [profile.addressLine1, profile.city, profile.state, profile.zip].filter(Boolean).join(", "),
      guardianName, locationName: form.location?.name ?? "Tee24", businessName: form.location?.name ?? "Tee24",
      contactName: ec.name, contactPhone: ec.phone, contactRelation: ec.relationship,
      date: today, today,
    } as Record<string, string>;
  }, [profile, guardianName, ec, form.location?.name]);
  function renderDoc(d: SignupDocument) {
    const vars: Record<string, string> = { ...mergeVars, documentName: d.name };
    return d.bodyHtml
      .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => (k in vars ? escapeHtml(vars[k] ?? "") : m))
      .replace(/\{([a-zA-Z_]+)\}/g, (m, k: string) => (k in vars ? escapeHtml(vars[k] ?? "") : m));
  }

  const otpSecondsLeft = phoneState.status === "sent" || phoneState.status === "verifying" ? Math.max(0, Math.ceil((phoneState.expiresAt - now) / 1000)) : 0;
  const resendIn = phoneState.status === "sent" || phoneState.status === "verifying" ? Math.max(0, 30 - Math.floor((now - phoneState.sentAt) / 1000)) : 0;

  return (
    <div className="min-h-screen bg-apple-bg py-8 sm:py-10">
      <div className="mx-auto max-w-3xl px-4">
        <header className="mb-6">
          <h1 className="text-apple-3xl font-semibold tracking-tight text-apple-text">{form.name}</h1>
          {form.description && <p className="mt-2 text-apple-base text-apple-text-secondary">{form.description}</p>}
          {form.location && <p className="mt-1 text-apple-sm text-apple-text-tertiary">{form.location.name}</p>}
        </header>

        {/* Stepper */}
        <ol className="mb-6 flex items-center gap-2 text-apple-xs">
          {(["Choose", "Your info", "Payment"] as const).map((label, i) => {
            const n = (i + 1) as Step;
            const active = step === n;
            const done = step > n;
            return (
              <li key={label} className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!done}
                  onClick={() => done && (n === 2 ? backToDetails() : setStep(n))}
                  className={[
                    "flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-medium",
                    active ? "border-apple-blue bg-apple-blue text-white" : done ? "border-apple-green bg-apple-green text-white" : "border-apple-border bg-white text-apple-text-tertiary",
                  ].join(" ")}
                  aria-label={`Step ${n}: ${label}`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : n}
                </button>
                <span className={active || done ? "font-medium text-apple-text" : "text-apple-text-tertiary"}>{label}</span>
                {i < 2 && <ChevronRight className="h-3 w-3 text-apple-text-tertiary" />}
              </li>
            );
          })}
        </ol>

        {/* ───────────────── Step 1: pass or membership + code ───────────────── */}
        {step === 1 && (
          <Card>
            <CardHeader title="Choose a pass or membership" subtitle="You can change plans any time from your member portal." />
            {groups.map((g) => (
              <div key={g.label} className="mt-5">
                {groups.length > 1 && <h3 className="mb-2 text-apple-xs font-semibold uppercase tracking-wide text-apple-text-tertiary">{g.label}</h3>}
                <div className="grid gap-3 sm:grid-cols-2">
                  {g.items.map((p) => {
                    const selected = selectedPlanId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => choosePlan(p.id)}
                        aria-pressed={selected}
                        className={[
                          "rounded-apple border p-4 text-left transition-colors",
                          selected ? "border-apple-blue bg-apple-blue/5 ring-2 ring-apple-blue/30" : "border-apple-border bg-white hover:border-apple-blue/30",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium text-apple-text">{p.name}</div>
                            {p.description && <div className="mt-1 text-apple-xs text-apple-text-tertiary">{p.description}</div>}
                          </div>
                          <span className={["mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", selected ? "border-apple-blue bg-apple-blue text-white" : "border-apple-border"].join(" ")}>
                            {selected && <Check className="h-3 w-3" />}
                          </span>
                        </div>
                        <div className="mt-3 flex items-baseline gap-2">
                          <Money cents={p.priceCents} currency={currency} className="text-apple-xl font-semibold text-apple-text" />
                          <span className="text-apple-xs text-apple-text-tertiary">{cadenceLabel(p)}</span>
                        </div>
                        {p.signupFeeCents > 0 && (
                          <div className="mt-1 text-apple-xs text-apple-text-tertiary">+ <Money cents={p.signupFeeCents} currency={currency} /> signup fee</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {plan && maxGuests > 0 && (
              <div className="mt-6 border-t border-apple-divider pt-5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-blue/10 text-apple-blue"><Users className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-apple-text">
                      {isDayPass
                        ? "How many guests will be coming with you?"
                        : <>Would you like to add a complimentary guest on every visit for <Money cents={plan.guestAddonCents ?? 0} currency={currency} />/{plan.billingCadence === "YEARLY" ? "yr" : "mo"}?</>}
                    </h3>
                    <p className="mt-0.5 text-apple-xs text-apple-text-tertiary">
                      {isDayPass
                        ? <>Guest pricing: {Array.from({ length: maxGuests }, (_, i) => i + 1).map((n, i) => <span key={n}>{i > 0 && ", "}guest {n} <Money cents={guestIncrementCents(plan, n)} currency={currency} /></span>)}.</>
                        : <>Bring up to {maxGuests} guest{maxGuests === 1 ? "" : "s"} on every visit — each one is an extra <Money cents={plan.guestAddonCents ?? 0} currency={currency} /> per {plan.billingCadence === "YEARLY" ? "year" : "month"}. Your membership becomes “{membershipDisplayName(plan.name, Math.max(1, guestCount))}”.</>}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Guests">
                      {Array.from({ length: maxGuests + 1 }, (_, n) => {
                        const selected = guestCount === n;
                        const cents = guestCentsFor(plan, n);
                        return (
                          <button
                            key={n}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setGuestCount(n)}
                            className={[
                              "rounded-apple border px-3 py-2 text-left text-apple-sm transition-colors",
                              selected ? "border-apple-blue bg-apple-blue/5 ring-2 ring-apple-blue/30" : "border-apple-border bg-white hover:border-apple-blue/30",
                            ].join(" ")}
                          >
                            <div className="font-medium text-apple-text">{n === 0 ? (isDayPass ? "Just me" : "No guest") : n === 1 ? "1 guest" : `${n} guests`}</div>
                            <div className="text-apple-xs text-apple-text-tertiary">{n === 0 ? "—" : <>+<Money cents={cents} currency={currency} />{isDayPass ? " today" : plan.billingCadence === "YEARLY" ? "/yr" : "/mo"}</>}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {plan && eligiblePromos.length > 0 && (
              <div className="mt-6 border-t border-apple-divider pt-5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-green/10 text-apple-green"><BadgePercent className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-apple-text">Current promotions</h3>
                    <p className="mt-0.5 text-apple-xs text-apple-text-tertiary">Pick one if it applies to you. Promotions can’t be combined with a discount code.</p>
                    <div className="mt-3 space-y-2">
                      {eligiblePromos.map((pr) => {
                        const selected = promoId === pr.id;
                        return (
                          <div key={pr.id} className={["rounded-apple border transition-colors", selected ? "border-apple-green bg-apple-green/5 ring-2 ring-apple-green/20" : "border-apple-border bg-white hover:border-apple-green/40"].join(" ")}>
                            <button type="button" onClick={() => choosePromo(pr.id)} aria-pressed={selected} className="flex w-full items-start justify-between gap-3 p-4 text-left">
                              <div className="min-w-0">
                                <div className="font-medium text-apple-text">{pr.title}</div>
                                {pr.description && <div className="mt-1 text-apple-xs text-apple-text-secondary">{pr.description}</div>}
                                <div className="mt-1 text-apple-xs text-apple-text-tertiary">
                                  {pr.type === "PERCENT" ? `${pr.value}% off` : <><Money cents={pr.value} currency={currency} /> off</>}
                                  {" · "}
                                  {pr.scope === "ONE_TIME" ? "first payment" : pr.scope === "FOREVER" || !pr.recurringMonths ? "every payment" : `first ${pr.recurringMonths} payments`}
                                  {pr.commitmentMonths ? ` · ${pr.commitmentMonths}-month minimum` : ""}
                                  {pr.requiresIdUpload ? " · ID required" : ""}
                                </div>
                              </div>
                              <span className={["mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", selected ? "border-apple-green bg-apple-green text-white" : "border-apple-border"].join(" ")}>
                                {selected && <Check className="h-3 w-3" />}
                              </span>
                            </button>
                            {selected && (pr.requiresIdUpload || (pr.commitmentMonths && pr.commitmentAcknowledgement)) && (
                              <div className="space-y-3 border-t border-apple-divider px-4 py-3">
                                {pr.requiresIdUpload && (
                                  <div>
                                    <div className="text-apple-sm font-medium text-apple-text">{pr.idUploadLabel ?? "Upload your qualifying ID"} <span className="text-apple-red">*</span></div>
                                    <p className="mt-0.5 text-apple-xs text-apple-text-tertiary">A clear photo or PDF of your military, veteran, first-responder, student or government ID. Our staff verifies it before your first visit.</p>
                                    <input ref={promoIdInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => onPromoIdPicked(e.target.files?.[0] ?? null)} />
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      <Button variant="secondary" size="sm" onClick={() => promoIdInputRef.current?.click()} loading={promoIdBusy}>
                                        <Upload className="h-4 w-4" /> {promoIdFile ? "Replace file" : "Upload ID"}
                                      </Button>
                                      {promoIdFile && (
                                        <span className="inline-flex items-center gap-1 text-apple-xs text-apple-green"><FileCheck className="h-4 w-4" /> {promoIdFile.name}</span>
                                      )}
                                    </div>
                                    {promoIdError && <p className="mt-1 text-apple-xs text-apple-red">{promoIdError}</p>}
                                  </div>
                                )}
                                {pr.commitmentMonths && pr.commitmentAcknowledgement ? (
                                  <label className="flex items-start gap-2 text-apple-sm text-apple-text">
                                    <input type="checkbox" className="mt-0.5 h-4 w-4 rounded accent-apple-blue" checked={promoAck} onChange={(e) => setPromoAck(e.target.checked)} />
                                    <span>{pr.commitmentAcknowledgement} <span className="text-apple-red">*</span></span>
                                  </label>
                                ) : null}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {promo && promoPreview && !promoPreview.ok && <p className="mt-2 text-apple-xs text-apple-red">{promoPreview.text}</p>}
                  </div>
                </div>
              </div>
            )}

            {form.allowDiscountCode && !promo && (
              <div className="mt-6 border-t border-apple-divider pt-4">
                <div className="flex items-end gap-2">
                  <Input label="Discount code (optional)" value={discount} autoCapitalize="characters" onChange={(e) => { setDiscount(e.target.value.toUpperCase()); setDiscountPreview(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void checkCode(); } }} />
                  <Button variant="secondary" onClick={checkCode} loading={checkingCode} disabled={!discount.trim() || !plan}>Apply</Button>
                </div>
                {discountPreview && <p className={`mt-1 text-apple-xs ${discountPreview.ok ? "text-apple-green" : "text-apple-red"}`}>{discountPreview.text}</p>}
              </div>
            )}

            {plan && (
              <dl className="mt-6 space-y-1.5 rounded-apple bg-apple-fill-secondary p-4 text-apple-sm">
                <Row label={plan.name} value={<Money cents={totals.base} currency={currency} />} />
                {totals.guests > 0 && <Row label={guestCount === 1 ? "1 guest" : `${guestCount} guests`} value={<Money cents={totals.guests} currency={currency} />} />}
                {totals.fee > 0 && <Row label="Signup fee" value={<Money cents={totals.fee} currency={currency} />} />}
                {totals.disc > 0 && <Row label={promo ? promo.title : "Discount"} value={<span className="text-apple-green">−<Money cents={totals.disc} currency={currency} /></span>} />}
                {totals.tax > 0 && <Row label="Tax" value={<Money cents={totals.tax} currency={currency} />} />}
                {totals.surcharge > 0 && <Row label="Card surcharge" value={<Money cents={totals.surcharge} currency={currency} />} />}
                <div className="my-1 border-t border-apple-divider" />
                <Row label="Due today" value={<span className="text-apple-base font-semibold"><Money cents={totals.total} currency={currency} /></span>} />
              </dl>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              {plan && !promoOk && <p className="text-apple-xs text-apple-text-tertiary">{promoNeedsId && !promoIdFile ? "Upload your ID to continue." : "Check the box to confirm the promotion terms."}</p>}
              <Button disabled={!plan || !promoOk} onClick={() => setStep(2)}>Continue</Button>
            </div>
          </Card>
        )}

        {/* ───────────────── Step 2: your information ───────────────── */}
        {step === 2 && (
          <div className="space-y-4">
            <Card>
              <CardHeader title="About you" />
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="First name" required autoComplete="given-name" value={profile.firstName} onChange={(e) => set("firstName", e.target.value)} />
                <Input label="Last name" required autoComplete="family-name" value={profile.lastName} onChange={(e) => set("lastName", e.target.value)} />
                <div className="sm:col-span-2">
                  <Input label="Email" type="email" required autoComplete="email" inputMode="email" value={profile.email} onChange={(e) => set("email", e.target.value)} error={profile.email && !emailOk ? "Enter a valid email address" : undefined} />
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="Mobile number" subtitle="We'll text you a 6-digit code. Your mobile number is how you'll sign in and book bays — no password needed." />
              <div className="mt-4 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <Input
                      label="Mobile number"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      required
                      placeholder="(555) 123-4567"
                      value={profile.phone}
                      onChange={(e) => onPhoneChange(e.target.value)}
                      disabled={phoneState.status === "sending" || phoneState.status === "verifying"}
                    />
                  </div>
                  {phoneState.status === "verified" ? (
                    <span className="inline-flex h-10 items-center gap-1.5 rounded-apple-sm bg-apple-green/10 px-3 text-apple-sm font-medium text-apple-green">
                      <ShieldCheck className="h-4 w-4" /> Verified
                    </span>
                  ) : (
                    <Button
                      variant={phoneState.status === "idle" ? "primary" : "secondary"}
                      onClick={sendCode}
                      loading={phoneState.status === "sending"}
                      disabled={digitsOnly(profile.phone).length !== 10 || (phoneState.status !== "idle" && resendIn > 0)}
                    >
                      {phoneState.status === "idle" ? "Text me a code" : resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                    </Button>
                  )}
                </div>

                {(phoneState.status === "sent" || phoneState.status === "verifying") && (
                  <div className="rounded-apple border border-apple-blue/20 bg-apple-blue/5 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="flex-1">
                        <Input
                          label={`Enter the code we texted to ${profile.phone}`}
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          value={otpCode}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                            setOtpCode(v);
                            if (v.length === 6) void verifyCode(v);
                          }}
                          className="text-center font-mono text-xl tracking-[0.4em]"
                          autoFocus
                        />
                      </div>
                      <Button onClick={() => verifyCode()} loading={phoneState.status === "verifying"} disabled={otpCode.length !== 6}>Verify</Button>
                    </div>
                    <p className="mt-2 text-apple-xs text-apple-text-tertiary">
                      {otpSecondsLeft > 0 ? `Code expires in ${Math.floor(otpSecondsLeft / 60)}:${String(otpSecondsLeft % 60).padStart(2, "0")}.` : "That code has expired — request a new one."}
                    </p>
                  </div>
                )}
                {phoneError && <p className="text-apple-sm text-apple-red">{phoneError}</p>}
              </div>
            </Card>

            <Card>
              <CardHeader title="Home address" />
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Input label="Street address" required autoComplete="address-line1" value={profile.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <Input label="Apt, suite, etc. (optional)" autoComplete="address-line2" value={profile.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} />
                </div>
                <Input label="City" required autoComplete="address-level2" value={profile.city} onChange={(e) => set("city", e.target.value)} />
                <div className="grid grid-cols-2 gap-4">
                  <Select label="State" required autoComplete="address-level1" value={profile.state} onChange={(e) => set("state", e.target.value)}>
                    <option value="">—</option>
                    {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                  <Input label="ZIP" required inputMode="numeric" autoComplete="postal-code" maxLength={10} value={profile.zip} onChange={(e) => set("zip", e.target.value.replace(/[^\d-]/g, ""))} error={profile.zip && !/^\d{5}(-\d{4})?$/.test(profile.zip) ? "5-digit ZIP" : undefined} />
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="Birthdate & sex" />
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Date of birth" type="date" required autoComplete="bday" max={new Date().toISOString().slice(0, 10)} value={profile.dob} onChange={(e) => set("dob", e.target.value)} hint={isMinor ? "Under 18 — a parent or guardian will need to sign the waiver below." : undefined} />
                <Select label="Sex" required value={profile.gender} onChange={(e) => set("gender", e.target.value)}>
                  <option value="">Select…</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                  <option value="UNSPECIFIED">Prefer not to say</option>
                </Select>
                {customFields.map((f) => (
                  <CustomFieldInput key={f.id} field={f} value={custom[f.id] ?? ""} onChange={(v) => setCustom((c) => ({ ...c, [f.id]: v }))} />
                ))}
              </div>
            </Card>

            {form.emergencyContactMode !== "hidden" && (
              <Card>
                <CardHeader title={`Emergency contact${form.emergencyContactMode === "optional" ? " (optional)" : ""}`} subtitle="Who should we call in an emergency?" />
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Input label="Full name" required={form.emergencyContactMode === "required"} autoComplete="off" value={ec.name} onChange={(e) => setEc((c) => ({ ...c, name: e.target.value }))} />
                  <Input label="Phone" type="tel" inputMode="tel" required={form.emergencyContactMode === "required"} autoComplete="off" placeholder="(555) 123-4567" value={ec.phone} onChange={(e) => setEc((c) => ({ ...c, phone: formatPhone(e.target.value) }))} />
                  <Input label="Relationship" required={form.emergencyContactMode === "required"} autoComplete="off" placeholder="Spouse, parent, friend…" value={ec.relationship} onChange={(e) => setEc((c) => ({ ...c, relationship: e.target.value }))} />
                </div>
              </Card>
            )}

            <Card>
              <CardHeader title="Profile photo" subtitle={`A clear photo of your face${photoOk && !photo ? " (optional)" : ""} — it's shown to staff when you check in.`} />
              <div className="mt-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-full border border-apple-border bg-apple-fill-secondary">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt="Your profile" className="h-full w-full object-cover" />
                  ) : (
                    <Camera className="h-8 w-8 text-apple-text-tertiary" />
                  )}
                </div>
                <div className="space-y-2">
                  <input ref={photoInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => void onPhotoPicked(e.target.files?.[0] ?? null)} />
                  <div className="flex flex-wrap gap-2">
                    <Button variant={photo ? "secondary" : "primary"} iconLeft={photo ? <RefreshCw className="h-4 w-4" /> : <Camera className="h-4 w-4" />} loading={photoBusy} onClick={() => photoInputRef.current?.click()}>
                      {photo ? "Retake / change" : "Take or upload a photo"}
                    </Button>
                    {photo && <Button variant="ghost" onClick={() => setPhoto(null)}>Remove</Button>}
                  </div>
                  {photoError && <p className="text-apple-sm text-apple-red">{photoError}</p>}
                  {!photoOk && <p className="text-apple-xs text-apple-text-tertiary">A photo is required for this membership.</p>}
                </div>
              </div>
            </Card>

            {documents.length > 0 && (
              <Card>
                <CardHeader title={documents.length === 1 ? documents[0]!.name : "Waivers & agreements"} subtitle="Please read and sign below." />
                <div className="mt-4 space-y-6">
                  {documents.map((d) => (
                    <div key={d.id}>
                      {documents.length > 1 && <h3 className="mb-2 font-medium text-apple-text">{d.name}</h3>}
                      {d.description && <p className="mb-2 text-apple-xs text-apple-text-tertiary">{d.description}</p>}
                      <div
                        className="prose prose-sm max-h-72 max-w-none overflow-y-auto rounded-apple border border-apple-border bg-white px-4 py-3 text-apple-text [&_h1]:text-apple-lg [&_h2]:text-apple-base [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                        dangerouslySetInnerHTML={{ __html: renderDoc(d) || "<p>(This document has no content.)</p>" }}
                      />
                      <div className="mt-3">
                        <SignaturePad
                          ref={(h) => { sigRefs.current[d.id] = h; }}
                          label={`${profile.firstName || "Member"} — sign here`}
                          onChange={(empty) => setSigEmpty((s) => ({ ...s, [d.id]: empty }))}
                        />
                      </div>
                    </div>
                  ))}

                  {isMinor && (
                    <div className="rounded-apple border border-apple-orange/40 bg-apple-orange/5 p-4">
                      <h3 className="font-medium text-apple-text">Parent / guardian signature</h3>
                      <p className="mt-1 text-apple-xs text-apple-text-secondary">Because the member is under 18, a parent or legal guardian must also sign.</p>
                      <div className="mt-3 space-y-3">
                        <Input label="Parent / guardian full name" required value={guardianName} onChange={(e) => setGuardianName(e.target.value)} />
                        <SignaturePad ref={guardianRef} label="Parent / guardian — sign here" onChange={setGuardianEmpty} />
                      </div>
                    </div>
                  )}

                  <label className="flex items-start gap-2 text-apple-sm">
                    <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-apple-blue" />
                    <span className="text-apple-text">I have read and agree to the {documents.length === 1 ? documents[0]!.name.toLowerCase() : "agreements above"}, and my signature above is my electronic signature.</span>
                  </label>
                </div>
              </Card>
            )}

            <Card>
              <div className="space-y-2 text-apple-sm">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={emailConsent} onChange={(e) => setEmailConsent(e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-apple-blue" />
                  <span className="text-apple-text">Email me about events, news, and offers (unsubscribe anytime)</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-apple-blue" />
                  <span className="text-apple-text">
                    Text me reminders & offers. Reply STOP to opt out. Msg & data rates may apply. Up to 4 msgs/month.
                    See our <Link href="/privacy" className="text-apple-blue hover:underline">privacy policy</Link>.
                  </span>
                </label>
                <p className="text-apple-xs text-apple-text-tertiary">Account and booking texts (codes, confirmations, receipts) are sent regardless.</p>
              </div>
              <div className="mt-6 flex justify-between">
                <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
                <Button onClick={goToPayment} disabled={!profileValid}>
                  {totals.total > 0 ? "Continue to payment" : "Continue"}
                </Button>
              </div>
              {!profileValid && (
                <p className="mt-2 text-right text-apple-xs text-apple-text-tertiary">
                  {!phoneVerified ? "Verify your mobile number to continue." : !docsOk ? "Sign the waiver to continue." : "Complete the required fields to continue."}
                </p>
              )}
            </Card>
          </div>
        )}

        {/* ───────────────── Step 3: payment ───────────────── */}
        {step === 3 && plan && (
          <div className="space-y-4">
            <Card>
              <CardHeader title="Review" />
              <dl className="mt-4 space-y-1.5 text-apple-sm">
                <Row label="Plan" value={displayName} />
                <Row label="Billed" value={cadenceLabel(plan).replace(/^\/ /, "")} />
                <Row label="Price" value={<Money cents={totals.base} currency={currency} />} />
                {totals.guests > 0 && <Row label={isDayPass ? `${guestCount} guest${guestCount === 1 ? "" : "s"} today` : `${guestCount} guest${guestCount === 1 ? "" : "s"} on every visit`} value={<Money cents={totals.guests} currency={currency} />} />}
                {totals.fee > 0 && <Row label="Signup fee" value={<Money cents={totals.fee} currency={currency} />} />}
                {totals.disc > 0 && <Row label={promo ? promo.title : "Discount"} value={<span className="text-apple-green">−<Money cents={totals.disc} currency={currency} /></span>} />}
                {promo?.commitmentMonths ? <Row label="Minimum term" value={`${promo.commitmentMonths} months`} /> : null}
                {promo?.requiresIdUpload && promoIdFile && <Row label="ID uploaded" value={<span className="text-apple-xs">{promoIdFile.name} · pending review</span>} />}
                {totals.tax > 0 && <Row label="Tax" value={<Money cents={totals.tax} currency={currency} />} />}
                {totals.surcharge > 0 && <Row label="Card surcharge" value={<Money cents={totals.surcharge} currency={currency} />} />}
                <div className="my-2 border-t border-apple-divider" />
                <Row label="Due today" value={<span className="text-apple-lg font-semibold text-apple-text"><Money cents={totals.total} currency={currency} /></span>} />
                <div className="my-2 border-t border-apple-divider" />
                <Row label="Name" value={`${profile.firstName} ${profile.lastName}`} />
                <Row label="Mobile" value={profile.phone} />
                <Row label="Email" value={profile.email} />
                {referralCode && <Row label="Referred by" value={<span className="font-mono text-apple-xs">{referralCode}</span>} />}
              </dl>
              <div className="mt-3 text-right">
                <Button variant="link" size="sm" onClick={backToDetails} disabled={submitting}>Edit details</Button>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Payment"
                subtitle={
                  totals.total <= 0
                    ? "Nothing to pay today."
                    : square.configured
                      ? "Powered by Square — your card details never touch our servers."
                      : "Online payments aren't available right now — we'll create your account and collect payment in person."
                }
              />

              {declined?.payToken ? (
                <div className="mt-4 space-y-3">
                  <p className="rounded-apple-sm border border-apple-red/30 bg-apple-red/5 p-3 text-apple-sm text-apple-red">{error ?? declined.error}</p>
                  <p className="text-apple-sm text-apple-text-secondary">Your account was created. Try another card to activate it, or pay later using the link we emailed you.</p>
                  <CardForm square={square} intent="CHARGE" amountCents={totals.total} currency={currency} billingContact={billingContact} onToken={retryPayment} buttonLabel={<>Pay <Money cents={totals.total} currency={currency} /></>} />
                  <Button variant="link" onClick={() => (window.location.href = declined.redirectUrl ?? "/portal")}>Skip for now</Button>
                </div>
              ) : totals.total > 0 && square.configured ? (
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
                    {plan.productType === "RECURRING" && (
                      <p className="text-apple-xs text-apple-text-tertiary">
                        Your card is saved securely with Square and charged <Money cents={promo && promo.scope !== "ONE_TIME" ? totals.price - totals.disc : totals.price} currency={currency} /> every {plan.billingCadence.toLowerCase().replace("ly", "")} until you cancel.{promo?.commitmentMonths ? ` ${promo.commitmentMonths}-month minimum applies.` : ""}
                      </p>
                    )}
                  </CardForm>
                  {error && <p className="mt-3 text-apple-sm text-apple-red">{error}</p>}
                </div>
              ) : (
                <>
                  {totals.total > 0 && (
                    <div className="mt-4 rounded-apple-sm border border-apple-border bg-apple-fill-secondary p-4 text-apple-sm text-apple-text-secondary">
                      We&apos;ll create your account now and collect <Money cents={totals.total} currency={currency} /> in person to activate it.
                    </div>
                  )}
                  {error && <p className="mt-3 text-apple-sm text-apple-red">{error}</p>}
                  <div className="mt-6 flex justify-end">
                    <Button onClick={() => submit().catch(() => {})} loading={submitting}>Complete signup</Button>
                  </div>
                </>
              )}

              {!declined && (
                <div className="mt-4">
                  <Button variant="secondary" onClick={backToDetails} disabled={submitting}>Back</Button>
                </div>
              )}

              <p className="mt-4 text-apple-xs text-apple-text-tertiary">
                By completing signup you agree to the membership terms{documents.length ? " and the agreement you signed" : ""}.
              </p>
            </Card>
          </div>
        )}

        <p className="mt-6 text-center text-apple-xs text-apple-text-tertiary">{form.location?.name}</p>
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
    <div className="flex items-center justify-between gap-4">
      <dt className="text-apple-text-secondary">{label}</dt>
      <dd className="text-right font-medium text-apple-text">{value}</dd>
    </div>
  );
}
