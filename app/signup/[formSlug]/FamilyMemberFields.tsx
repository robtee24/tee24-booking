"use client";

/**
 * One family member's details on the signup form (and reused by the clubhouse
 * "Add a family member" page). A family member is a full member — same required
 * fields as the account holder: name, email, their own mobile (used to sign in),
 * birthdate, sex, profile photo and a signed waiver. Minors are signed for by the
 * account holder.
 */
import React, { useMemo, useState } from "react";
import { Button, Card, CardHeader, Input, Money, Select } from "@/components/ui";
import { SignaturePad, type SignaturePadHandle } from "@/components/portal/SignaturePad";
import { Camera, RefreshCw, Trash2 } from "lucide-react";
import { ageFromDob, digitsOnly, escapeHtml, fileToPhotoDataUrl, formatPhone } from "./photo-utils";

export type FamilyDraft = {
  key: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dob: string;
  gender: string;
  relationship: string;
  photo: string | null;
};

export type FamilyDoc = { id: string; name: string; bodyHtml: string };

export const FAMILY_RELATIONSHIPS: Array<[string, string]> = [
  ["SPOUSE", "Spouse / partner"],
  ["CHILD", "Child"],
  ["PARENT", "Parent"],
  ["OTHER", "Other family"],
];

export function newFamilyDraft(): FamilyDraft {
  const key = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { key, firstName: "", lastName: "", email: "", phone: "", dob: "", gender: "", relationship: "SPOUSE", photo: null };
}

export function familyDraftValid(d: FamilyDraft, opts: { requiredFields: string[]; photoRequired: boolean; docsSigned: boolean; takenEmails: string[]; takenPhones: string[] }): string | null {
  const who = d.firstName.trim() || "Family member";
  if (!d.firstName.trim() || !d.lastName.trim()) return `${who}: first and last name`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return `${who}: a valid email`;
  if (opts.takenEmails.filter((e) => e === d.email.trim().toLowerCase()).length > 1) return `${who}: each person needs their own email`;
  if (digitsOnly(d.phone).length !== 10) return `${who}: a 10-digit mobile number`;
  if (opts.takenPhones.filter((p) => p === digitsOnly(d.phone)).length > 1) return `${who}: each person needs their own mobile number`;
  const age = ageFromDob(d.dob);
  if (!d.dob || age === null || age < 0 || age > 120) return `${who}: date of birth`;
  if (!d.gender) return `${who}: sex`;
  if ((opts.photoRequired || opts.requiredFields.includes("photo")) && !d.photo) return `${who}: a profile photo`;
  if (!opts.docsSigned) return `${who}: signature`;
  return null;
}

export function FamilyMemberFields({
  index,
  draft,
  onChange,
  onRemove,
  documents,
  photoRequired,
  planName,
  priceCents,
  currency,
  cadence,
  holderName,
  locationName,
  sigRef,
  onSigChange,
}: {
  index: number;
  draft: FamilyDraft;
  onChange: (next: FamilyDraft) => void;
  onRemove?: () => void;
  documents: FamilyDoc[];
  photoRequired: boolean;
  planName: string;
  priceCents: number;
  currency: string;
  cadence: string;
  holderName: string;
  locationName: string;
  sigRef: (docId: string, handle: SignaturePadHandle | null) => void;
  onSigChange: (docId: string, empty: boolean) => void;
}) {
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoInputRef = React.useRef<HTMLInputElement>(null);
  const set = <K extends keyof FamilyDraft>(k: K, v: FamilyDraft[K]) => onChange({ ...draft, [k]: v });
  const age = ageFromDob(draft.dob);
  const isMinor = age !== null && age < 18;
  const name = `${draft.firstName} ${draft.lastName}`.trim();

  async function onPhotoPicked(file: File | null) {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      set("photo", await fileToPhotoDataUrl(file));
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Could not read that photo");
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  const mergeVars = useMemo(() => {
    const today = new Date().toLocaleDateString();
    return {
      firstName: draft.firstName, lastName: draft.lastName, fullName: name, memberName: name, name,
      email: draft.email, phone: draft.phone, dob: draft.dob ? new Date(draft.dob + "T00:00:00").toLocaleDateString() : "",
      guardianName: isMinor ? holderName : "", locationName, businessName: locationName, date: today, today,
    } as Record<string, string>;
  }, [draft, name, isMinor, holderName, locationName]);
  function renderDoc(d: FamilyDoc) {
    const vars: Record<string, string> = { ...mergeVars, documentName: d.name };
    return d.bodyHtml
      .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => (k in vars ? escapeHtml(vars[k] ?? "") : m))
      .replace(/\{([a-zA-Z_]+)\}/g, (m, k: string) => (k in vars ? escapeHtml(vars[k] ?? "") : m));
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <CardHeader title={`Family member ${index + 1}${name ? ` — ${name}` : ""}`} />
          <p className="mt-1 text-apple-sm text-apple-text-secondary">{planName} at <Money cents={priceCents} currency={currency} />/{cadence}. They get their own membership and door access; you&apos;re billed for it.</p>
        </div>
        {onRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove family member"><Trash2 className="h-4 w-4" /></Button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="First name" required value={draft.firstName} onChange={(e) => set("firstName", e.target.value)} />
        <Input label="Last name" required value={draft.lastName} onChange={(e) => set("lastName", e.target.value)} />
        <Select label="Relationship to you" required value={draft.relationship} onChange={(e) => set("relationship", e.target.value)}>
          {FAMILY_RELATIONSHIPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Input label="Email" type="email" required inputMode="email" value={draft.email} onChange={(e) => set("email", e.target.value)} hint="Their own address — used for receipts and waivers." />
        <Input
          label="Mobile number"
          type="tel"
          inputMode="tel"
          required
          placeholder="(555) 123-4567"
          value={draft.phone}
          onChange={(e) => set("phone", formatPhone(e.target.value))}
          hint="Their own number — it's how they sign in to the Tee24 app. We'll text them a code the first time."
        />
        <Input label="Date of birth" type="date" required max={new Date().toISOString().slice(0, 10)} value={draft.dob} onChange={(e) => set("dob", e.target.value)} hint={isMinor ? `Under 18 — you'll sign the waiver for ${draft.firstName || "them"} as parent/guardian.` : undefined} />
        <Select label="Sex" required value={draft.gender} onChange={(e) => set("gender", e.target.value)}>
          <option value="">Select…</option>
          <option value="MALE">Male</option>
          <option value="FEMALE">Female</option>
          <option value="OTHER">Other</option>
          <option value="UNSPECIFIED">Prefer not to say</option>
        </Select>
      </div>

      <div className="mt-5">
        <div className="text-apple-sm font-medium text-apple-text">Profile photo{photoRequired ? "" : " (optional)"}</div>
        <div className="mt-2 flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-apple-border bg-apple-fill-secondary">
            {draft.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={draft.photo} alt={name || "Family member"} className="h-full w-full object-cover" />
            ) : (
              <Camera className="h-6 w-6 text-apple-text-tertiary" />
            )}
          </div>
          <div className="space-y-1">
            <input ref={photoInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => void onPhotoPicked(e.target.files?.[0] ?? null)} />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" iconLeft={draft.photo ? <RefreshCw className="h-4 w-4" /> : <Camera className="h-4 w-4" />} loading={photoBusy} onClick={() => photoInputRef.current?.click()}>
                {draft.photo ? "Change photo" : "Take or upload a photo"}
              </Button>
              {draft.photo && <Button variant="ghost" size="sm" onClick={() => set("photo", null)}>Remove</Button>}
            </div>
            {photoError && <p className="text-apple-xs text-apple-red">{photoError}</p>}
          </div>
        </div>
      </div>

      {documents.length > 0 && (
        <div className="mt-5 space-y-4">
          {documents.map((d) => (
            <div key={d.id}>
              <details className="rounded-apple border border-apple-border bg-white">
                <summary className="cursor-pointer px-4 py-2 text-apple-sm font-medium text-apple-text">{d.name} — read</summary>
                <div
                  className="prose prose-sm max-h-60 max-w-none overflow-y-auto border-t border-apple-divider px-4 py-3 text-apple-text [&_h1]:text-apple-lg [&_h2]:text-apple-base [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                  dangerouslySetInnerHTML={{ __html: renderDoc(d) || "<p>(This document has no content.)</p>" }}
                />
              </details>
              <div className="mt-2">
                <SignaturePad
                  ref={(h) => sigRef(d.id, h)}
                  label={isMinor ? `${holderName || "Parent / guardian"} — sign for ${draft.firstName || "this member"}` : `${draft.firstName || "Family member"} — sign here`}
                  onChange={(empty) => onSigChange(d.id, empty)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
