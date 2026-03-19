// components/OtpFlow.tsx
"use client";

import React from "react";
import { toE164 } from "@/lib/phone";

type Props = {
  startEndpoint: string;
  verifyEndpoint: string;
  title?: string;
  subtitle?: string;
  initialPhone?: string;
  onSuccess: () => void;
  sendButtonText?: string;
  successDelayMs?: number;
};

export default function OtpFlow({
  startEndpoint,
  verifyEndpoint,
  title = "",
  subtitle = "",
  initialPhone = "",
  onSuccess,
  sendButtonText = "Send Code",
  successDelayMs = 0,
}: Props) {
  const [step, setStep] = React.useState<"phone" | "code">(
    initialPhone ? "code" : "phone"
  );

  const [phoneInput, setPhoneInput] = React.useState("");
  const [phoneE164, setPhoneE164] = React.useState<string>(initialPhone);
  const [code, setCode] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    let normalized: string;
    try {
      normalized = toE164(phoneInput || phoneE164);
    } catch {
      return setMessage("Please enter a valid phone number");
    }

    setPhoneE164(normalized);
    setLoading(true);

    try {
      const res = await fetch(startEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalized }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send code");

      setStep("code");
      setMessage("Check your phone — we sent a 6-digit code");
    } catch (err: any) {
      setMessage(err.message || "Failed to send code");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    const digits = code.replace(/\D/g, "").slice(0, 6);
    if (digits.length !== 6) {
      return setMessage("Please enter all 6 digits");
    }

    setLoading(true);

    try {
      const res = await fetch(verifyEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneE164, code: digits }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");

      setMessage("Verified!");
      setTimeout(() => onSuccess(), successDelayMs);
    } catch (err: any) {
      setMessage(err.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm card p-8 space-y-6">
      {(title || subtitle) && (
        <div className="text-center">
          {title && <h2 className="text-apple-2xl font-semibold tracking-tight text-apple-text">{title}</h2>}
          {subtitle && <p className="mt-2 text-apple-sm text-apple-text-secondary">{subtitle}</p>}
        </div>
      )}

      {message && (
        <div
          className={`rounded-apple-sm px-4 py-3 text-apple-sm font-medium ${
            message.includes("sent") || message.includes("Verified")
              ? "bg-apple-green/5 border border-apple-green/30 text-apple-green"
              : "bg-apple-red/5 border border-apple-red/30 text-apple-red"
          }`}
        >
          {message}
        </div>
      )}

      {step === "phone" && (
        <form onSubmit={requestCode} className="space-y-5">
          <div>
            <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">
              Phone number
            </label>
            <input
              type="tel"
              placeholder="(555) 123-4567"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              className="input"
              required
              disabled={loading}
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full !py-3">
            {loading ? "Sending..." : sendButtonText}
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verifyCode} className="space-y-5">
          <div>
            <label className="mb-1.5 block text-apple-sm font-medium text-apple-text">
              6-digit code
            </label>
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

          <button
            type="button"
            onClick={requestCode}
            disabled={loading}
            className="btn-secondary w-full"
          >
            Resend Code
          </button>
        </form>
      )}
    </div>
  );
}
