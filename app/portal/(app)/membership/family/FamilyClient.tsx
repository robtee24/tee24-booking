"use client";

/**
 * Clubhouse → Membership → Family. The account holder sees who's on their family
 * plan, adds a new family member (full member details + waiver; the rest of the
 * current period is charged to the card on file) and can end a family member's
 * membership at the end of the paid period.
 */
import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button, Card, CardHeader, Modal, Money, StatusBadge } from "@/components/ui";
import type { SignaturePadHandle } from "@/components/portal/SignaturePad";
import type { FamilyView } from "@/services/family-addon.service";
import { FamilyMemberFields, familyDraftValid, newFamilyDraft, type FamilyDraft } from "@/app/signup/[formSlug]/FamilyMemberFields";
import { digitsOnly } from "@/app/signup/[formSlug]/photo-utils";

type Props = {
  initial: FamilyView;
  canEdit: boolean;
  holderName: string;
  holderEmail: string;
  holderPhone: string;
  locationName: string;
};

export function FamilyClient({ initial, canEdit, holderName, holderEmail, holderPhone, locationName }: Props) {
  const router = useRouter();
  const [view, setView] = useState<FamilyView>(initial);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<FamilyDraft>(() => newFamilyDraft());
  const sigRefs = React.useRef<Record<string, SignaturePadHandle | null>>({});
  const [sigEmpty, setSigEmpty] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; paid: boolean; payUrl: string | null; chargedCents: number } | null>(null);
  const [removing, setRemoving] = useState<{ subscriptionId: string; name: string } | null>(null);

  if (!view.available) {
    return (
      <Card>
        <CardHeader title="Family plan" />
        <p className="mt-3 text-apple-sm text-apple-text-secondary">{view.reason}</p>
        <div className="mt-4"><Link href="/portal/membership" className="text-apple-sm text-apple-blue hover:underline">← Back to membership</Link></div>
      </Card>
    );
  }
  const fam = view;
  const cadence = fam.billingCadence === "YEARLY" ? "yr" : "mo";
  const slotsLeft = fam.maxAdditional - fam.members.filter((m) => m.status !== "CANCELLED").length;
  const problem = familyDraftValid(draft, {
    requiredFields: fam.requiredFields,
    photoRequired: fam.requiredFields.includes("photo"),
    docsSigned: fam.documents.every((d) => !(sigEmpty[d.id] ?? true)),
    takenEmails: [holderEmail.toLowerCase(), draft.email.trim().toLowerCase()],
    takenPhones: [digitsOnly(holderPhone).slice(-10), digitsOnly(draft.phone)],
  });

  function startAdd() {
    setDraft(newFamilyDraft());
    setSigEmpty({});
    setError(null);
    setDone(null);
    setAdding(true);
  }

  async function submitAdd() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/membership/family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          email: draft.email.trim(),
          phone: draft.verifiedPhone ?? draft.phone,
          phoneToken: draft.phoneToken,
          dob: draft.dob,
          gender: draft.gender,
          relationship: draft.relationship,
          photoDataUrl: draft.photo,
          signatures: fam.documents.map((d) => {
            const pad = sigRefs.current[d.id];
            return { documentId: d.id, signatureSvg: pad?.toSvgDataUrl() ?? pad?.toDataUrl() ?? null };
          }),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Something went wrong");
      setView(json.family);
      setDone({ name: `${draft.firstName} ${draft.lastName}`.trim(), paid: json.result.paid, payUrl: json.result.payUrl, chargedCents: json.result.chargedCents });
      setAdding(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/membership/family", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId: removing.subscriptionId }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Something went wrong");
      setView(json.family);
      setRemoving(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`Family on your ${fam.planName}`}
          subtitle={`Add up to ${fam.maxAdditional} family members at ${fam.percentOff}% off — $${(fam.memberPriceCents / 100).toFixed(fam.memberPriceCents % 100 ? 2 : 0)}/${cadence} each, billed with your membership. Each person gets their own login, photo and door access.`}
        />
        {done && (
          <div className="mt-3 rounded-apple-sm bg-apple-green/10 px-4 py-3 text-apple-sm text-apple-green">
            {done.name} has been added.{" "}
            {done.paid
              ? done.chargedCents > 0 ? <>We charged <Money cents={done.chargedCents} /> to your card for the rest of this period.</> : "Nothing to pay until your next renewal."
              : done.payUrl
                ? <>Their membership activates once the prorated <Money cents={done.chargedCents} /> is paid — <a href={done.payUrl} className="underline">pay now</a>.</>
                : "Their membership activates once the prorated charge is paid."}
            {" "}They can sign in to the Tee24 app with their mobile number.
          </div>
        )}
        {!canEdit && <p className="mt-3 text-apple-sm text-apple-text-tertiary">Family changes are disabled while staff are viewing this account.</p>}

        {fam.members.length > 0 ? (
          <ul className="mt-4 divide-y divide-apple-divider">
            {fam.members.map((m) => (
              <li key={m.subscriptionId} className="flex items-center gap-3 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-apple-fill-secondary text-apple-sm font-semibold text-apple-text-secondary">
                  {m.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.photoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    `${m.firstName[0] ?? ""}${m.lastName[0] ?? ""}`
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-apple-sm font-medium text-apple-text">{m.firstName} {m.lastName}</div>
                  <div className="text-apple-xs text-apple-text-tertiary">
                    {m.relationship ? `${m.relationship[0]}${m.relationship.slice(1).toLowerCase()} · ` : ""}<Money cents={m.priceCents} />/{cadence}
                    {m.status === "CANCEL_SCHEDULED" && m.paidThroughDate ? ` · ends ${new Date(m.paidThroughDate).toLocaleDateString()}` : ""}
                    {m.status === "PENDING" ? " · awaiting payment" : ""}
                  </div>
                </div>
                <StatusBadge status={m.status} size="sm" />
                {canEdit && (m.status === "ACTIVE" || m.status === "PENDING") && (
                  <Button variant="ghost" size="sm" onClick={() => setRemoving({ subscriptionId: m.subscriptionId, name: `${m.firstName} ${m.lastName}` })}>Remove</Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-apple-sm text-apple-text-secondary">No family members yet.</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {!adding && (
            <Button iconLeft={<UserPlus className="h-4 w-4" />} onClick={startAdd} disabled={!canEdit || slotsLeft <= 0}>
              Add a family member
            </Button>
          )}
          {slotsLeft <= 0 && <span className="text-apple-xs text-apple-text-tertiary">You&apos;ve used all {fam.maxAdditional} family slots on this plan.</span>}
          <Link href="/portal/membership" className="text-apple-sm text-apple-blue hover:underline">Back to membership</Link>
        </div>
      </Card>

      {adding && (
        <>
          <FamilyMemberFields
            index={fam.members.length}
            draft={draft}
            onChange={setDraft}
            documents={fam.documents.map((d) => ({ id: d.id, name: d.name, bodyHtml: d.bodyHtml ?? "" }))}
            photoRequired={fam.requiredFields.includes("photo")}
            planName={fam.planName}
            priceCents={fam.memberPriceCents}
            currency="USD"
            cadence={cadence}
            holderName={holderName}
            locationName={locationName}
            sigRef={(docId, h) => { sigRefs.current[docId] = h; }}
            onSigChange={(docId, empty) => setSigEmpty((s) => ({ ...s, [docId]: empty }))}
          />
          <Card>
            <p className="text-apple-sm text-apple-text-secondary">
              We&apos;ll charge your card on file for the rest of the current period today (prorated), then <Money cents={fam.memberPriceCents} />/{cadence} is added to your regular bill{fam.nextInvoiceDate ? ` starting ${new Date(fam.nextInvoiceDate).toLocaleDateString()}` : ""}. You can remove a family member any time; their access runs to the end of the paid period.
            </p>
            {error && <p className="mt-3 text-apple-sm text-apple-red">{error}</p>}
            <div className="mt-4 flex items-center justify-between gap-3">
              <Button variant="secondary" onClick={() => setAdding(false)} disabled={busy}>Cancel</Button>
              <div className="flex items-center gap-3">
                {problem && <span className="text-apple-xs text-apple-text-tertiary">Needed: {problem}</span>}
                <Button onClick={() => void submitAdd()} loading={busy} disabled={!!problem}>Add &amp; pay</Button>
              </div>
            </div>
          </Card>
        </>
      )}

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name ?? ""}?`}
        description="Their membership and door access continue until the end of the period you've already paid for, then stop. Nothing more is billed for them."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>Keep</Button>
            <Button variant="danger" onClick={() => void confirmRemove()} loading={busy}>Remove</Button>
          </>
        }
      >
        {error && <p className="text-apple-sm text-apple-red">{error}</p>}
      </Modal>
    </div>
  );
}
