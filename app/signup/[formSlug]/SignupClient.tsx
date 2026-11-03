"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card, CardHeader, Input, Money, Select } from "@/components/ui";
import { CardForm } from "@/components/payments/CardForm";
import { SignaturePad, type SignaturePadHandle } from "@/components/portal/SignaturePad";
import type { SquarePublicConfig } from "@/lib/square";
import { BadgePercent, Camera, Check, ChevronRight, FileCheck, RefreshCw, ShieldCheck, Upload, UserPlus, Users, X } from "lucide-react";
import { familyAddonFor, familyMemberCents, guestCentsFor, guestIncrementCents, maxGuestsFor, membershipDisplayName, type SignupPromo } from "@/lib/membership-pricing";
import { FamilyMemberFields, familyDraftValid, newFamilyDraft, type FamilyDraft } from "./FamilyMemberFields";
import { ageFromDob, digitsOnly, escapeHtml, fileToPhotoDataUrl, fileToUploadDataUrl, formatPhone } from "./photo-utils";

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
  familyBundle: boolean;
  familyDiscountConfig: unknown;
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

function cadenceLabel(p: Plan) {
  if (p.productType === "DAY_PASS") return p.durationDays && p.durationDays > 1 ? `${p.durationDays}-day pass` : "day pass";
  if (p.productType === "PUNCH_CARD") return "one-time";
  if (p.billingCadence === "ONE_OFF") return p.durationDays ? `${p.durationDays} days` : "one-time";
  return `/ ${p.billingCadence.toLowerCase()}`;
}
export function SignupClient({ form, plans, promos, customFields, documents, utm, referralCode: refFromUrl, square, staging = false }: FormProps) {
  const stagingQs = staging ? "&staging=1" : "";
  const [step, setStep] = useState<Step>(1);
  const [selectedPlanId, setSelectedPlanId] = useState(form.defaultPlanId ?? plans[0]?.id ?? "");
  const [guestCount, setGuestCount] = useState(0);
  // Signup promotions — any number can be combined, with each other and with discount codes
  const [promoIds, setPromoIds] = useState<string[]>([]);
  const [promoPreviews, setPromoPreviews] = useState<Record<string, { ok: boolean; text: string; amountCents: number; scope: string }>>({});
  const [promoIdFiles, setPromoIdFiles] = useState<Record<string, { name: string; dataUrl: string }>>({});
  const [promoIdBusy, setPromoIdBusy] = useState<string | null>(null);
  const [promoIdErrors, setPromoIdErrors] = useState<Record<string, string>>({});
  const [promoAcks, setPromoAcks] = useState<Record<string, boolean>>({});
  const promoIdInputRefs = React.useRef<Record<string, HTMLInputElement | null>>({});
  // Family add-on (extra members at a % off, billed to this account)
  const [family, setFamily] = useState<FamilyDraft[]>([]);
  const familySigRefs = React.useRef<Record<string, SignaturePadHandle | null>>({});
  const [familySigEmpty, setFamilySigEmpty] = useState<Record<string, boolean>>({});
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
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [appliedCodes, setAppliedCodes] = useState<Array<{ code: string; text: string; amountCents: number; scope: string }>>([]);
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
  const selectedPromos = eligiblePromos.filter((pr) => promoIds.includes(pr.id));
  const promoMissingId = selectedPromos.find((pr) => pr.requiresIdUpload && !promoIdFiles[pr.id]) ?? null;
  const promoMissingAck = selectedPromos.find((pr) => pr.commitmentMonths && pr.commitmentAcknowledgement && !promoAcks[pr.id]) ?? null;
  const promoOk = !promoMissingId && !promoMissingAck;
  const maxCommitment = selectedPromos.reduce((m, pr) => Math.max(m, pr.commitmentMonths ?? 0), 0);
  const familyAddon = plan ? familyAddonFor(plan) : null;
  const familyEachCents = plan && familyAddon ? familyMemberCents(plan.priceCents, familyAddon.percentOff) : 0;
  const perLabel = plan?.billingCadence === "YEARLY" ? "yr" : "mo";
  const promoKey = promoIds.join(",");
  const codeKey = appliedCodes.map((c) => c.code).join(",");

  // Server-authoritative preview of each selected promotion for this plan + guest count
  React.useEffect(() => {
    if (!plan || promoIds.length === 0) { setPromoPreviews({}); return; }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(promoIds.map(async (id) => {
        try {
          const res = await fetch(`/api/signup?formSlug=${encodeURIComponent(form.slug)}&planId=${encodeURIComponent(plan.id)}&guestCount=${guestCount}&promoId=${encodeURIComponent(id)}${stagingQs}`);
          const json = await res.json();
          return [id, json.ok ? { ok: true, text: json.description, amountCents: json.amountCents ?? 0, scope: json.scope ?? "ONE_TIME" } : { ok: false, text: json.reason ?? "This promotion isn't available", amountCents: 0, scope: "" }] as const;
        } catch {
          return [id, { ok: false, text: "Could not load promotion", amountCents: 0, scope: "" }] as const;
        }
      }));
      if (!cancelled) setPromoPreviews(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id, guestCount, form.slug, promoKey]);

  // Re-price applied discount codes when the plan or guest count changes
  React.useEffect(() => {
    if (!plan || appliedCodes.length === 0) return;
    let cancelled = false;
    (async () => {
      const next = await Promise.all(appliedCodes.map(async (c) => {
        try {
          const res = await fetch(`/api/signup?formSlug=${encodeURIComponent(form.slug)}&planId=${encodeURIComponent(plan.id)}&guestCount=${guestCount}&code=${encodeURIComponent(c.code)}${stagingQs}`);
          const json = await res.json();
          return json.ok ? { ...c, text: json.description, amountCents: json.amountCents ?? 0, scope: json.scope ?? c.scope } : null;
        } catch {
          return c;
        }
      }));
      if (!cancelled) setAppliedCodes(next.filter((c): c is NonNullable<typeof c> => Boolean(c)));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id, guestCount, form.slug, codeKey]);

  function choosePlan(id: string) {
    const next = plans.find((p) => p.id === id);
    setSelectedPlanId(id);
    setDiscountError(null);
    setGuestCount((g) => Math.min(g, next ? maxGuestsFor(next) : 0));
    setPromoIds((cur) => cur.filter((pid) => promos.some((pr) => pr.id === pid && (pr.planIds.length === 0 || (next && pr.planIds.includes(next.id))))));
    const addon = next ? familyAddonFor(next) : null;
    setFamily((cur) => cur.slice(0, addon ? addon.maxAdditional : 0));
  }
  function togglePromo(id: string) {
    setPromoIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setPromoIdErrors((e) => ({ ...e, [id]: "" }));
  }
  async function onPromoIdPicked(id: string, file: File | null) {
    if (!file) return;
    setPromoIdBusy(id);
    setPromoIdErrors((e) => ({ ...e, [id]: "" }));
    try {
      const dataUrl = await fileToUploadDataUrl(file);
      setPromoIdFiles((f) => ({ ...f, [id]: { name: file.name, dataUrl } }));
    } catch (e) {
      setPromoIdErrors((er) => ({ ...er, [id]: e instanceof Error ? e.message : "Could not read that file" }));
    } finally {
      setPromoIdBusy(null);
      const el = promoIdInputRefs.current[id];
      if (el) el.value = "";
    }
  }
  function setFamilyCount(n: number) {
    setFamily((cur) => (n > cur.length ? [...cur, ...Array.from({ length: n - cur.length }, () => newFamilyDraft())] : cur.slice(0, n)));
  }
  function removeFamilyMember(key: string) {
    setFamily((cur) => cur.filter((f) => f.key !== key));
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
      { label: "Day pass", items: passes },
      { label: "Memberships", items: memberships },
      { label: "Lessons & packs", items: [...packs, ...other] },
    ].filter((g) => g.items.length > 0);
  }, [plans]);

  // Price preview (server is authoritative)
  const totals = useMemo(() => {
    const base = plan?.priceCents ?? 0;
    const guests = plan ? guestCentsFor(plan, guestCount) : 0;
    const price = base + guests;
    const fee = plan?.signupFeeCents ?? 0;
    const familyCents = familyEachCents * family.length;
    const promoDisc = selectedPromos.reduce((sum, pr) => sum + (promoPreviews[pr.id]?.ok ? promoPreviews[pr.id]!.amountCents : 0), 0);
    const codeDisc = appliedCodes.reduce((sum, c) => sum + c.amountCents, 0);
    const disc = Math.min(price, promoDisc + codeDisc);
    // What renews each period: standing (non one-time) discounts keep applying
    const recurringDisc = Math.min(price,
      selectedPromos.reduce((sum, pr) => sum + (promoPreviews[pr.id]?.ok && promoPreviews[pr.id]!.scope !== "ONE_TIME" ? promoPreviews[pr.id]!.amountCents : 0), 0) +
      appliedCodes.reduce((sum, c) => sum + (c.scope !== "ONE_TIME" ? c.amountCents : 0), 0));
    const taxable = price + familyCents + fee - disc;
    const tax = form.collectTax && form.location ? Math.round((taxable * form.location.taxRateBps) / 10_000) : 0;
    const surcharge = square.configured && form.location ? Math.round(((taxable + tax) * form.location.cardSurchargeBps) / 10_000) : 0;
    return { base, guests, price, familyCents, fee, disc, recurring: price + familyCents - recurringDisc, tax, surcharge, total: taxable + tax + surcharge };
  }, [plan, guestCount, familyEachCents, family.length, selectedPromos, promoPreviews, appliedCodes, form.collectTax, form.location, square.configured]);
  const discountLabel = [...selectedPromos.map((pr) => pr.title), ...appliedCodes.map((c) => c.code)].join(" + ") || "Discount";

  const phoneVerified = phoneState.status === "verified";
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim());
  const addressOk = !!profile.addressLine1.trim() && !!profile.city.trim() && !!profile.state && /^\d{5}(-\d{4})?$/.test(profile.zip.trim());
  const photoOk = !!photo || !(isRequired("photo") || form.photoRequired);
  const ecOk = form.emergencyContactMode !== "required" || (!!ec.name.trim() && digitsOnly(ec.phone).length === 10);
  const docsOk = documents.every((d) => !sigEmpty[d.id]) && (!isMinor || (!!guardianName.trim() && !guardianEmpty)) && (documents.length === 0 || agree);
  const takenEmails = [profile.email.trim().toLowerCase(), ...family.map((f) => f.email.trim().toLowerCase())];
  const takenPhones = [digitsOnly(profile.phone), ...family.map((f) => digitsOnly(f.phone))];
  const familyProblem = family.length && isMinor
    ? "You must be 18 or older to add family members."
    : family.map((f) => familyDraftValid(f, { requiredFields: form.requiredFields, photoRequired: form.photoRequired || isRequired("photo"), docsSigned: documents.every((d) => !familySigEmpty[`${f.key}:${d.id}`]), takenEmails, takenPhones })).find(Boolean) ?? null;
  const familyOk = !familyProblem;
  const profileValid =
    !!profile.firstName.trim() && !!profile.lastName.trim() && emailOk && phoneVerified &&
    !!profile.dob && age !== null && age >= 0 && age < 120 && !!profile.gender &&
    addressOk && photoOk && docsOk && ecOk && familyOk &&
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

  async function applyCode() {
    const code = discount.trim().toUpperCase();
    if (!code || !plan) return;
    if (appliedCodes.some((c) => c.code.toUpperCase() === code)) { setDiscountError("That code is already applied."); return; }
    setCheckingCode(true);
    setDiscountError(null);
    try {
      const res = await fetch(`/api/signup?formSlug=${encodeURIComponent(form.slug)}&planId=${encodeURIComponent(plan.id)}&guestCount=${guestCount}&code=${encodeURIComponent(code)}${stagingQs}`);
      const json = await res.json();
      if (json.ok) {
        if (selectedPromos.some((pr) => pr.code.toUpperCase() === String(json.code).toUpperCase())) { setDiscountError("That promotion is already selected above."); return; }
        setAppliedCodes((c) => [...c, { code: json.code ?? code, text: json.description, amountCents: json.amountCents ?? 0, scope: json.scope ?? "ONE_TIME" }]);
        setDiscount("");
      } else setDiscountError(json.reason ?? "Invalid code");
    } catch {
      setDiscountError("Could not check code");
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
    const familyMembers = family.map((f) => ({
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      email: f.email.trim(),
      phone: f.verifiedPhone ?? f.phone,
      phoneToken: f.phoneToken,
      dob: f.dob,
      gender: f.gender,
      relationship: f.relationship,
      photoDataUrl: f.photo,
      signatures: documents.map((d) => {
        const pad = familySigRefs.current[`${f.key}:${d.id}`];
        return { documentId: d.id, signatureSvg: pad?.toSvgDataUrl() ?? pad?.toDataUrl() ?? null };
      }),
    }));
    return { signatures, guardian, familyMembers };
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
    setFamilySigEmpty({});
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
          discountCodes: appliedCodes.map((c) => c.code),
          guestCount: maxGuests > 0 ? guestCount : 0,
          promoDiscountIds: selectedPromos.map((pr) => pr.id),
          promoIdDataUrls: Object.fromEntries(selectedPromos.filter((pr) => pr.requiresIdUpload && promoIdFiles[pr.id]).map((pr) => [pr.id, promoIdFiles[pr.id]!.dataUrl])),
          promoAcknowledged: selectedPromos.every((pr) => !pr.commitmentMonths || !pr.commitmentAcknowledgement || !!promoAcks[pr.id]),
          familyMembers: sigs.familyMembers,
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
            <CardHeader title="Choose a pass or membership" subtitle="Every option includes 24/7 door access via the Tee24 app. Members can change plans any time." />
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

            {plan && (maxGuests > 0 || familyAddon) && (
              <h3 className="mt-6 border-t border-apple-divider pt-5 text-apple-xs font-semibold uppercase tracking-wide text-apple-text-tertiary">Add-ons</h3>
            )}

            {plan && maxGuests > 0 && (
              <div className="mt-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-blue/10 text-apple-blue"><Users className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-apple-text">
                      {isDayPass
                        ? "Bringing guests today?"
                        : <>Guests — <Money cents={plan.guestAddonCents ?? 0} currency={currency} /> per guest per {plan.billingCadence === "YEARLY" ? "year" : "month"}</>}
                    </h3>
                    <p className="mt-0.5 text-apple-xs text-apple-text-tertiary">
                      {isDayPass
                        ? <>Up to {maxGuests}. Guest pricing: {Array.from({ length: maxGuests }, (_, i) => i + 1).map((n, i) => <span key={n}>{i > 0 && ", "}guest {n} <Money cents={guestIncrementCents(plan, n)} currency={currency} /></span>)}.</>
                        : <>Bring up to {maxGuests} guest{maxGuests === 1 ? "" : "s"} with you on every visit. Your membership becomes “{membershipDisplayName(plan.name, Math.max(1, guestCount))}”.</>}
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

            {plan && familyAddon && (
              <div className="mt-5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-blue/10 text-apple-blue"><UserPlus className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-apple-text">Family members — {familyAddon.percentOff}% off, <Money cents={familyEachCents} currency={currency} />/{perLabel} each</h3>
                    <p className="mt-0.5 text-apple-xs text-apple-text-tertiary">
                      Add up to {familyAddon.maxAdditional} family member{familyAddon.maxAdditional === 1 ? "" : "s"} on the same {plan.name} plan. Each gets their own full membership, app login and door access — all billed to your card. You&apos;ll enter their details on the next step.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Family members">
                      {Array.from({ length: familyAddon.maxAdditional + 1 }, (_, n) => {
                        const selected = family.length === n;
                        return (
                          <button
                            key={n}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setFamilyCount(n)}
                            className={[
                              "rounded-apple border px-3 py-2 text-left text-apple-sm transition-colors",
                              selected ? "border-apple-blue bg-apple-blue/5 ring-2 ring-apple-blue/30" : "border-apple-border bg-white hover:border-apple-blue/30",
                            ].join(" ")}
                          >
                            <div className="font-medium text-apple-text">{n === 0 ? "Just me" : n === 1 ? "1 family member" : `${n} family members`}</div>
                            <div className="text-apple-xs text-apple-text-tertiary">{n === 0 ? "—" : <>+<Money cents={familyEachCents * n} currency={currency} />/{perLabel}</>}</div>
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
                    <h3 className="font-medium text-apple-text">Discounts</h3>
                    <p className="mt-0.5 text-apple-xs text-apple-text-tertiary">Select every promotion that applies to you — they can be combined with each other and with a discount code.</p>
                    <div className="mt-3 space-y-2">
                      {eligiblePromos.map((pr) => {
                        const selected = promoIds.includes(pr.id);
                        const preview = promoPreviews[pr.id];
                        return (
                          <div key={pr.id} className={["rounded-apple border transition-colors", selected ? "border-apple-green bg-apple-green/5 ring-2 ring-apple-green/20" : "border-apple-border bg-white hover:border-apple-green/40"].join(" ")}>
                            <button type="button" onClick={() => togglePromo(pr.id)} aria-pressed={selected} className="flex w-full items-start justify-between gap-3 p-4 text-left">
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
                              <span className={["mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border", selected ? "border-apple-green bg-apple-green text-white" : "border-apple-border"].join(" ")}>
                                {selected && <Check className="h-3 w-3" />}
                              </span>
                            </button>
                            {selected && preview && !preview.ok && <p className="px-4 pb-3 text-apple-xs text-apple-red">{preview.text}</p>}
                            {selected && (pr.requiresIdUpload || (pr.commitmentMonths && pr.commitmentAcknowledgement)) && (
                              <div className="space-y-3 border-t border-apple-divider px-4 py-3">
                                {pr.requiresIdUpload && (
                                  <div>
                                    <div className="text-apple-sm font-medium text-apple-text">{pr.idUploadLabel ?? "Upload your qualifying ID"} <span className="text-apple-red">*</span></div>
                                    <p className="mt-0.5 text-apple-xs text-apple-text-tertiary">A clear photo or PDF of your military, veteran, first-responder, student or government ID. Our staff verifies it before your first visit.</p>
                                    <input ref={(el) => { promoIdInputRefs.current[pr.id] = el; }} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => onPromoIdPicked(pr.id, e.target.files?.[0] ?? null)} />
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      <Button variant="secondary" size="sm" onClick={() => promoIdInputRefs.current[pr.id]?.click()} loading={promoIdBusy === pr.id}>
                                        <Upload className="h-4 w-4" /> {promoIdFiles[pr.id] ? "Replace file" : "Upload ID"}
                                      </Button>
                                      {promoIdFiles[pr.id] && (
                                        <span className="inline-flex items-center gap-1 text-apple-xs text-apple-green"><FileCheck className="h-4 w-4" /> {promoIdFiles[pr.id]!.name}</span>
                                      )}
                                    </div>
                                    {promoIdErrors[pr.id] && <p className="mt-1 text-apple-xs text-apple-red">{promoIdErrors[pr.id]}</p>}
                                  </div>
                                )}
                                {pr.commitmentMonths && pr.commitmentAcknowledgement ? (
                                  <label className="flex items-start gap-2 text-apple-sm text-apple-text">
                                    <input type="checkbox" className="mt-0.5 h-4 w-4 rounded accent-apple-blue" checked={!!promoAcks[pr.id]} onChange={(e) => setPromoAcks((a) => ({ ...a, [pr.id]: e.target.checked }))} />
                                    <span>{pr.commitmentAcknowledgement} <span className="text-apple-red">*</span></span>
                                  </label>
                                ) : null}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {form.allowDiscountCode && (
              <div className={`mt-6 ${eligiblePromos.length ? "" : "border-t border-apple-divider pt-4"}`}>
                <div className="flex items-end gap-2">
                  <Input label={appliedCodes.length ? "Add another discount code" : "Discount code (optional)"} value={discount} autoCapitalize="characters" onChange={(e) => { setDiscount(e.target.value.toUpperCase()); setDiscountError(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void applyCode(); } }} />
                  <Button variant="secondary" onClick={applyCode} loading={checkingCode} disabled={!discount.trim() || !plan}>Apply</Button>
                </div>
                {discountError && <p className="mt-1 text-apple-xs text-apple-red">{discountError}</p>}
                {appliedCodes.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {appliedCodes.map((c) => (
                      <li key={c.code} className="inline-flex items-center gap-1.5 rounded-full border border-apple-green/40 bg-apple-green/5 py-1 pl-3 pr-1.5 text-apple-xs text-apple-green">
                        <Check className="h-3 w-3" /> <span className="font-medium">{c.code}</span> <span className="text-apple-text-secondary">· {c.text}</span>
                        <button type="button" aria-label={`Remove ${c.code}`} onClick={() => setAppliedCodes((cur) => cur.filter((x) => x.code !== c.code))} className="ml-0.5 rounded-full p-0.5 text-apple-text-tertiary hover:bg-apple-fill-secondary hover:text-apple-text"><X className="h-3 w-3" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {plan && (
              <dl className="mt-6 space-y-1.5 rounded-apple bg-apple-fill-secondary p-4 text-apple-sm">
                <Row label={plan.name} value={<Money cents={totals.base} currency={currency} />} />
                {totals.guests > 0 && <Row label={guestCount === 1 ? "1 guest" : `${guestCount} guests`} value={<Money cents={totals.guests} currency={currency} />} />}
                {totals.familyCents > 0 && <Row label={family.length === 1 ? "1 family member" : `${family.length} family members`} value={<Money cents={totals.familyCents} currency={currency} />} />}
                {totals.fee > 0 && <Row label="Signup fee" value={<Money cents={totals.fee} currency={currency} />} />}
                {totals.disc > 0 && <Row label={discountLabel} value={<span className="text-apple-green">−<Money cents={totals.disc} currency={currency} /></span>} />}
                {totals.tax > 0 && <Row label="Tax" value={<Money cents={totals.tax} currency={currency} />} />}
                {totals.surcharge > 0 && <Row label="Card surcharge" value={<Money cents={totals.surcharge} currency={currency} />} />}
                <div className="my-1 border-t border-apple-divider" />
                <Row label="Due today" value={<span className="text-apple-base font-semibold"><Money cents={totals.total} currency={currency} /></span>} />
              </dl>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              {plan && !promoOk && <p className="text-apple-xs text-apple-text-tertiary">{promoMissingId ? `Upload your ID for “${promoMissingId.title}” to continue.` : "Check the box to confirm the promotion terms."}</p>}
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

            {family.length > 0 && plan && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 pt-2">
                  <UserPlus className="h-4 w-4 text-apple-blue" />
                  <h2 className="text-apple-base font-semibold text-apple-text">Your family members</h2>
                </div>
                {isMinor && <p className="rounded-apple border border-apple-red/30 bg-apple-red/5 p-3 text-apple-sm text-apple-red">You must be 18 or older to add family members to your account.</p>}
                {family.map((f, i) => (
                  <FamilyMemberFields
                    key={f.key}
                    index={i}
                    draft={f}
                    onChange={(next) => setFamily((cur) => cur.map((x) => (x.key === f.key ? next : x)))}
                    onRemove={() => removeFamilyMember(f.key)}
                    documents={documents}
                    photoRequired={form.photoRequired || isRequired("photo")}
                    planName={plan.name}
                    priceCents={familyEachCents}
                    currency={currency}
                    cadence={perLabel}
                    holderName={`${profile.firstName} ${profile.lastName}`.trim()}
                    locationName={form.location?.name ?? "Tee24"}
                    sigRef={(docId, h) => { familySigRefs.current[`${f.key}:${docId}`] = h; }}
                    onSigChange={(docId, empty) => setFamilySigEmpty((st) => ({ ...st, [`${f.key}:${docId}`]: empty }))}
                  />
                ))}
                {familyAddon && family.length < familyAddon.maxAdditional && (
                  <Button variant="secondary" size="sm" iconLeft={<UserPlus className="h-4 w-4" />} onClick={() => setFamilyCount(family.length + 1)}>Add another family member</Button>
                )}
              </div>
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
                  {!phoneVerified ? "Verify your mobile number to continue." : !docsOk ? "Sign the waiver to continue." : familyProblem ? `Family: ${familyProblem}.` : "Complete the required fields to continue."}
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
                {family.map((f) => <Row key={f.key} label={`Family: ${f.firstName} ${f.lastName}`.trim()} value={<Money cents={familyEachCents} currency={currency} />} />)}
                {totals.fee > 0 && <Row label="Signup fee" value={<Money cents={totals.fee} currency={currency} />} />}
                {totals.disc > 0 && <Row label={discountLabel} value={<span className="text-apple-green">−<Money cents={totals.disc} currency={currency} /></span>} />}
                {maxCommitment > 0 ? <Row label="Minimum term" value={`${maxCommitment} months`} /> : null}
                {selectedPromos.filter((pr) => pr.requiresIdUpload && promoIdFiles[pr.id]).map((pr) => <Row key={pr.id} label="ID uploaded" value={<span className="text-apple-xs">{promoIdFiles[pr.id]!.name} · pending review</span>} />)}
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
                        Your card is saved securely with Square and charged <Money cents={totals.recurring} currency={currency} /> every {plan.billingCadence.toLowerCase().replace("ly", "")} until you cancel{family.length ? " — that covers you and your family members" : ""}.{maxCommitment ? ` ${maxCommitment}-month minimum applies.` : ""}
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
