"use client";

import React from "react";
import { toE164 } from "@/lib/phone";
import { adminRoutes } from "@/lib/admin/routes";

type Step = "phone" | "code" | "totp";

/**
 * Admin login: phone → SMS code → (if 2FA is enabled) authenticator code.
 * OTP-only admins never see the third step.
 */
export default function AdminLoginFlow({ redirectTo }: { redirectTo?: string | null }) {
  const [step, setStep] = React.useState<Step>("phone");
  const [phoneInput, setPhoneInput] = React.useState("");
  const [phoneE164, setPhoneE164] = React.useState("");
  const [code, setCode] = React.useState("");
  const [totp, setTotp] = React.useState("");
  const [message, setMessage] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = React.useState(false);

  const target = redirectTo && redirectTo.startsWith("/admin") ? redirectTo : adminRoutes.home();

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data as { ok: boolean; requires2fa?: boolean };
  }

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setMessage(null);
    let normalized: string;
    try {
      normalized = toE164(phoneInput || phoneE164);
    } catch {
      return setMessage({ tone: "err", text: "Please enter a valid phone number" });
    }
    setPhoneE164(normalized);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalized }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to send code");
      setStep("code");
      setCode("");
      setMessage({ tone: "ok", text: "Check your phone — we sent a 6-digit code" });
    } catch (err: unknown) {
      setMessage({ tone: "err", text: err instanceof Error ? err.message : "Failed to send code" });
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const digits = code.replace(/\D/g, "").slice(0, 6);
    if (digits.length !== 6) return setMessage({ tone: "err", text: "Please enter all 6 digits" });
    setLoading(true);
    try {
      const data = await post({ phone: phoneE164, code: digits });
      if (data.requires2fa) {
        setStep("totp");
        setTotp("");
        setMessage({ tone: "ok", text: "Now enter the code from your authenticator app" });
      } else {
        setMessage({ tone: "ok", text: "Verified!" });
        window.location.href = target;
      }
    } catch (err: unknown) {
      setMessage({ tone: "err", text: err instanceof Error ? err.message : "Verification failed" });
    } finally {
      setLoading(false);
    }
  }

  async function verifyTotp(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const digits = totp.replace(/\D/g, "").slice(0, 6);
    if (digits.length !== 6) return setMessage({ tone: "err", text: "Please enter all 6 digits" });
    setLoading(true);
    try {
      await post({ totp: digits });
      setMessage({ tone: "ok", text: "Verified!" });
      window.location.href = target;
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : "Verification failed";
      setMessage({ tone: "err", text });
      // Pending state expired → go back to the start.
      if (/expired|start over/i.test(text)) {
        setStep("phone");
        setCode("");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card w-full max-w-sm space-y-6 p-8">
      <div className="text-center">
        <h2 className="text-apple-2xl font-semibold tracking-tight text-apple-text">Tee24 Admin Login</h2>
        <p className="mt-2 text-apple-sm text-apple-text-secondary">
          {step === "phone" && "Enter your phone to receive a one-time code"}
          {step === "code" && "Enter the 6-digit code we texted you"}
          {step === "totp" && "Two-factor authentication"}
        </p>
      </div>

      <Stepper step={step} />

      {message && (
        <div
          role="status"
          className={`rounded-apple-sm px-4 py-3 text-apple-sm font-medium ${
            message.tone === "ok"
              ? "border border-apple-green/30 bg-apple-green/5 text-apple-green"
              : "border border-apple-red/30 bg-apple-red/5 text-apple-red"
          }`}
        >
          {message.text}
        </div>
      )}

      {step === "phone" && (
        <form onSubmit={requestCode} className="space-y-5">
          <div>
            <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Phone number</label>
            <input
              type="tel"
              placeholder="(555) 123-4567"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              className="input"
              required
              disabled={loading}
              autoFocus
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full !py-3">
            {loading ? "Sending..." : "Send Code"}
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verifyOtp} className="space-y-5">
          <div>
            <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">6-digit code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="input text-center text-2xl tracking-widest"
              maxLength={6}
              required
              disabled={loading}
              autoFocus
            />
            <p className="mt-2 text-apple-xs text-apple-text-tertiary">
              Sent to <span className="font-medium">{phoneE164}</span>
            </p>
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full !py-3">
            {loading ? "Verifying..." : "Verify"}
          </button>
          <button type="button" onClick={() => void requestCode()} disabled={loading} className="btn-secondary w-full">
            Resend Code
          </button>
        </form>
      )}

      {step === "totp" && (
        <form onSubmit={verifyTotp} className="space-y-5">
          <div>
            <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">Authenticator code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="input text-center text-2xl tracking-widest"
              maxLength={6}
              required
              disabled={loading}
              autoFocus
            />
            <p className="mt-2 text-apple-xs text-apple-text-tertiary">
              Open Google Authenticator, 1Password, or Authy and enter the 6-digit code for Tee24. This step expires after 5 minutes.
            </p>
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full !py-3">
            {loading ? "Verifying..." : "Finish sign-in"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setMessage(null);
            }}
            disabled={loading}
            className="btn-secondary w-full"
          >
            Start over
          </button>
        </form>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "phone", label: "Phone" },
    { key: "code", label: "SMS code" },
    { key: "totp", label: "2FA" },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <ol className="flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-apple-text-tertiary" aria-label="Sign-in progress">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
              i < idx ? "bg-apple-green text-white" : i === idx ? "bg-apple-blue text-white" : "bg-apple-fill-secondary"
            }`}
          >
            {i + 1}
          </span>
          <span className={i === idx ? "text-apple-text" : ""}>{s.label}</span>
          {i < steps.length - 1 && <span className="h-px w-4 bg-apple-border" />}
        </li>
      ))}
    </ol>
  );
}
