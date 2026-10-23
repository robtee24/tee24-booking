"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, CardHeader, Input } from "@/components/ui";

function formatPhone(v: string) {
  const d = v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export default function PortalLoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginInner />
    </React.Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/portal";
  const urlError = sp.get("error");

  const [mode, setMode] = useState<"phone" | "email">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"enter" | "code">("enter");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(urlError === "invalid-token" ? "That sign-in link is invalid or expired." : null);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (phone.replace(/\D/g, "").length !== 10) return setError("Enter your 10-digit mobile number.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/auth/otp/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not send code");
      setStage("code");
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code");
    } finally {
      setBusy(false);
    }
  }

  async function verify(c = code) {
    if (!/^\d{6}$/.test(c)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/auth/otp/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, code: c }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Invalid code");
      router.replace(next.startsWith("/") ? next : "/portal");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
      setBusy(false);
    }
  }

  async function sendMagic(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/auth/magic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      if (!res.ok) throw new Error(await res.text());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-apple-bg">
      <div className="mx-auto max-w-md px-4 py-16">
        <h1 className="mb-6 text-center text-apple-2xl font-semibold tracking-tight">Sign in</h1>
        <Card>
          {mode === "phone" ? (
            <>
              <CardHeader title="Member sign-in" subtitle={stage === "enter" ? "We'll text a 6-digit code to the mobile number on your account." : `Enter the code we texted to ${phone}.`} />
              {stage === "enter" ? (
                <form onSubmit={sendCode} className="mt-4 space-y-4">
                  <Input label="Mobile number" type="tel" inputMode="tel" autoComplete="tel-national" required placeholder="(555) 123-4567" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} autoFocus />
                  {error && <p className="text-apple-sm text-apple-red">{error}</p>}
                  <Button type="submit" loading={busy} className="w-full">Text me a code</Button>
                </form>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); void verify(); }} className="mt-4 space-y-4">
                  <Input
                    label="6-digit code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setCode(v);
                      if (v.length === 6) void verify(v);
                    }}
                    className="text-center font-mono text-xl tracking-[0.4em]"
                    autoFocus
                  />
                  {error && <p className="text-apple-sm text-apple-red">{error}</p>}
                  <Button type="submit" loading={busy} disabled={code.length !== 6} className="w-full">Sign in</Button>
                  <div className="flex justify-between text-apple-xs">
                    <button type="button" className="text-apple-blue hover:underline" onClick={() => { setStage("enter"); setError(null); }}>Change number</button>
                    <button type="button" className="text-apple-blue hover:underline" onClick={() => void sendCode()} disabled={busy}>Resend code</button>
                  </div>
                </form>
              )}
              <p className="mt-4 text-center text-apple-xs text-apple-text-tertiary">
                Can&apos;t receive texts?{" "}
                <button type="button" className="text-apple-blue hover:underline" onClick={() => { setMode("email"); setError(null); }}>Email me a sign-in link</button>
              </p>
            </>
          ) : (
            <>
              <CardHeader title="Email sign-in link" subtitle="We'll email you a one-tap login link." />
              {sent ? (
                <p className="mt-4 text-apple-sm text-apple-text">
                  If an account exists for <strong>{email}</strong>, a sign-in link is on its way.
                </p>
              ) : (
                <form onSubmit={sendMagic} className="mt-4 space-y-4">
                  <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
                  {error && <p className="text-apple-sm text-apple-red">{error}</p>}
                  <Button type="submit" loading={busy} className="w-full">Send sign-in link</Button>
                </form>
              )}
              <p className="mt-4 text-center text-apple-xs text-apple-text-tertiary">
                <button type="button" className="text-apple-blue hover:underline" onClick={() => { setMode("phone"); setError(null); }}>Sign in with my mobile number instead</button>
              </p>
            </>
          )}
        </Card>
        <p className="mt-4 text-center text-apple-xs text-apple-text-tertiary">By signing in you agree to our terms of service.</p>
      </div>
    </div>
  );
}
