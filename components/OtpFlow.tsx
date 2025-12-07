// components/OtpFlow.tsx
"use client";

import React from "react";
import { toE164 } from "@/lib/phone";

type Props = {
  /** Where to POST when requesting OTP */
  startEndpoint: string;
  /** Where to POST when verifying OTP */
  verifyEndpoint: string;

  /** Optional: title above the form */
  title?: string;
  /** Optional: subtitle under title */
  subtitle?: string;

  /** Optional: if provided, skip phone entry and go straight to code screen */
  initialPhone?: string;

  /** Called after successful verification */
  onSuccess: () => void;

  /** Customize the "Send Code" button text */
  sendButtonText?: string;

  /** Delay before calling onSuccess (ms) */
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
  // If initialPhone is passed, start in code mode with that phone
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
    <div className="w-full max-w-sm space-y-6 rounded-2xl border bg-white p-8 shadow-lg">
      {/* Title (only shown if provided) */}
      {(title || subtitle) && (
        <div className="text-center">
          {title && <h2 className="text-2xl font-bold">{title}</h2>}
          {subtitle && <p className="mt-2 text-sm text-neutral-600">{subtitle}</p>}
        </div>
      )}

      {/* Message */}
      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm font-medium ${
            message.includes("sent") || message.includes("Verified")
              ? "bg-green-50 text-green-800"
              : "bg-red-50 text-red-800"
          }`}
        >
          {message}
        </div>
      )}

      {/* Phone Entry */}
      {step === "phone" && (
        <form onSubmit={requestCode} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-neutral-700">
              Phone number
            </label>
            <input
              type="tel"
              placeholder="(555) 123-4567"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              className="mt-1.5 block w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-black"
              required
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-black py-3.5 font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
          >
            {loading ? "Sending..." : sendButtonText}
          </button>
        </form>
      )}

      {/* Code Entry */}
      {step === "code" && (
        <form onSubmit={verifyCode} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-neutral-700">
              6-digit code
            </label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="mt-1.5 block w-full rounded-xl border px-4 py-3 text-center text-2xl tracking-widest focus:outline-none focus:ring-2 focus:ring-black"
              maxLength={6}
              required
              disabled={loading}
              autoFocus
            />
            <p className="mt-2 text-xs text-neutral-500">
              Sent to <span className="font-medium">{phoneE164}</span>
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-black py-3.5 font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
          >
            {loading ? "Verifying..." : "Verify"}
          </button>

          <button
            type="button"
            onClick={requestCode}
            disabled={loading}
            className="w-full rounded-xl border border-neutral-300 py-3 font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Resend Code
          </button>
        </form>
      )}
    </div>
  );
}