"use client";

import React from "react";
import Link from "next/link";
import { CheckCircle2, FileSignature, ShieldCheck, Clock, AlertTriangle } from "lucide-react";
import { Button, Card, CardHeader, Input } from "@/components/ui";
import { SignaturePad, type SignaturePadHandle } from "./SignaturePad";

export type SigningViewDTO = {
  state: "ready" | "signed" | "expired" | "invalid";
  assignmentId?: string;
  documentName?: string;
  description?: string | null;
  bodyHtml?: string;
  memberName?: string;
  isMinor?: boolean;
  signedAt?: string | null;
  expiresAt?: string | null;
  locationName?: string | null;
};

/**
 * Shared signing experience. Rendered both at /sign/[token] (public — the
 * token is the credential) and /portal/documents/sign/[token] (logged-in).
 */
export function SignDocumentView({ token, view, backHref, backLabel, loggedIn }: { token: string; view: SigningViewDTO; backHref: string; backLabel: string; loggedIn: boolean }) {
  const [typedName, setTypedName] = React.useState("");
  const [guardianName, setGuardianName] = React.useState("");
  const [consent, setConsent] = React.useState(false);
  const [sigEmpty, setSigEmpty] = React.useState(true);
  const [initialsEmpty, setInitialsEmpty] = React.useState(true);
  const [scrolledToEnd, setScrolledToEnd] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ signedAt: string | null } | null>(null);
  const sigRef = React.useRef<SignaturePadHandle>(null);
  const initialsRef = React.useRef<SignaturePadHandle>(null);
  const docRef = React.useRef<HTMLDivElement>(null);

  // Require the member to at least reach the bottom of the document text.
  React.useEffect(() => {
    const el = docRef.current;
    if (!el) return;
    const check = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 24 || el.scrollHeight <= el.clientHeight + 8) setScrolledToEnd(true);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    return () => el.removeEventListener("scroll", check);
  }, [view.bodyHtml]);

  if (view.state === "invalid") {
    return (
      <Shell title="Link not recognised" icon={<AlertTriangle className="h-6 w-6 text-apple-red" />}>
        <p className="text-apple-sm text-apple-text-secondary">This signing link isn&apos;t valid. It may have been copied incorrectly — ask the front desk to resend it.</p>
        <Back href={backHref} label={backLabel} />
      </Shell>
    );
  }
  if (view.state === "expired") {
    return (
      <Shell title="This link has expired" icon={<Clock className="h-6 w-6 text-apple-orange" />}>
        <p className="text-apple-sm text-apple-text-secondary">
          The signing link for <span className="font-medium text-apple-text">{view.documentName}</span>
          {view.expiresAt ? ` expired ${new Date(view.expiresAt).toLocaleDateString()}` : " is no longer active"}. Ask {view.locationName ?? "the front desk"} to send a fresh one.
        </p>
        <Back href={backHref} label={backLabel} />
      </Shell>
    );
  }
  if (view.state === "signed" || done) {
    const at = done?.signedAt ?? view.signedAt;
    return (
      <Shell title="Signed — thank you" icon={<CheckCircle2 className="h-6 w-6 text-apple-green" />}>
        <p className="text-apple-sm text-apple-text-secondary">
          <span className="font-medium text-apple-text">{view.documentName}</span> was signed{at ? ` on ${new Date(at).toLocaleString()}` : ""}. A copy is kept on your account{loggedIn ? " under Documents" : ""}.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={backHref} className="btn-primary inline-flex items-center px-4 py-2 text-apple-sm">{backLabel}</Link>
          {!loggedIn && (
            <Link href="/portal/login" className="btn-secondary inline-flex items-center px-4 py-2 text-apple-sm">Sign in to the member portal</Link>
          )}
        </div>
      </Shell>
    );
  }

  const canSubmit = typedName.trim().length >= 2 && !sigEmpty && consent && (!view.isMinor || guardianName.trim().length >= 2) && !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const signatureDataUrl = sigRef.current?.toSvgDataUrl() ?? sigRef.current?.toDataUrl();
    if (!signatureDataUrl) return setError("Please draw your signature.");
    const initialsDataUrl = initialsEmpty ? null : initialsRef.current?.toSvgDataUrl() ?? initialsRef.current?.toDataUrl() ?? null;
    setSubmitting(true);
    try {
      const res = await fetch("/api/portal/documents/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, typedName: typedName.trim(), signatureDataUrl, initialsDataUrl, guardianName: view.isMinor ? guardianName.trim() : null, consent }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setDone({ signedAt: json.signedAt ?? new Date().toISOString() });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-apple-sm bg-apple-blue/10 text-apple-blue">
          <FileSignature className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-apple-2xl font-semibold tracking-tight text-apple-text">{view.documentName}</h1>
          <p className="text-apple-sm text-apple-text-secondary">
            For {view.memberName}
            {view.locationName ? ` · ${view.locationName}` : ""}
            {view.expiresAt ? ` · link expires ${new Date(view.expiresAt).toLocaleDateString()}` : ""}
          </p>
          {view.description && <p className="mt-1 text-apple-sm text-apple-text-secondary">{view.description}</p>}
        </div>
      </div>

      <Card padded={false}>
        <div
          ref={docRef}
          className="prose prose-sm max-h-[60vh] max-w-none overflow-y-auto px-6 py-5 text-apple-text [&_h1]:text-apple-xl [&_h2]:text-apple-lg [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
          dangerouslySetInnerHTML={{ __html: view.bodyHtml || "<p>(This document has no content.)</p>" }}
        />
        {!scrolledToEnd && (
          <div className="border-t border-apple-divider bg-apple-fill-secondary/60 px-6 py-2 text-center text-apple-xs text-apple-text-tertiary">Scroll to the end of the document to continue</div>
        )}
      </Card>

      <form onSubmit={submit} className="space-y-5">
        <Card>
          <CardHeader title="Your signature" subtitle="Draw with your finger, stylus, or mouse." />
          <div className="mt-4 space-y-4">
            <div>
              <SignaturePad ref={sigRef} height={170} onChange={setSigEmpty} />
              <div className="mt-1 flex justify-end">
                <button type="button" onClick={() => sigRef.current?.clear()} className="text-apple-xs text-apple-text-tertiary hover:text-apple-text">Clear</button>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Type your full legal name" value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder={view.memberName} autoComplete="name" required />
              <div>
                <span className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Initials (optional)</span>
                <SignaturePad ref={initialsRef} height={72} label="Initials" onChange={setInitialsEmpty} />
              </div>
            </div>
            {view.isMinor && (
              <div className="rounded-apple-sm border border-apple-orange/30 bg-apple-orange/5 p-4">
                <Input label="Parent or guardian's full name" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} required hint="Our records show this member is under 18. A parent or legal guardian must sign on their behalf." />
              </div>
            )}
            <label className="flex items-start gap-3 text-apple-sm text-apple-text">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-apple-blue" />
              <span>
                I have read and agree to the terms of this document, and I consent to sign it electronically. My typed name and drawn signature are the legal equivalent of my handwritten signature.
              </span>
            </label>
          </div>
        </Card>

        {error && <div className="rounded-apple-sm border border-apple-red/30 bg-apple-red/5 px-4 py-3 text-apple-sm text-apple-red">{error}</div>}

        <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-1.5 text-apple-xs text-apple-text-tertiary">
            <ShieldCheck className="h-3.5 w-3.5" /> We record the time, IP address, and device used to sign.
          </p>
          <Button type="submit" size="lg" disabled={!canSubmit} loading={submitting}>
            Sign {view.documentName}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Shell({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="mx-auto max-w-lg">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="min-w-0 flex-1">
          <h1 className="text-apple-xl font-semibold text-apple-text">{title}</h1>
          <div className="mt-2">{children}</div>
        </div>
      </div>
    </Card>
  );
}

function Back({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mt-4 inline-block text-apple-sm font-medium text-apple-blue hover:underline">
      {label}
    </Link>
  );
}
