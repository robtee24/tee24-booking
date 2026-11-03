"use client";

/**
 * Mobile number + SMS one-time-code verification, self-contained.
 *
 * Used for each family member on the signup form and the clubhouse "Add a
 * family member" page. On success the parent receives `{ phone (E.164), token }`
 * — the same signed proof the account holder's own number carries — which the
 * API requires before it will create the member (the number is their login).
 */
import React, { useState } from "react";
import { Button, Input } from "@/components/ui";
import { ShieldCheck } from "lucide-react";
import { digitsOnly, formatPhone } from "./photo-utils";

export type VerifiedPhone = { phone: string; token: string };

type State =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent"; expiresAt: number; sentAt: number }
  | { status: "verifying"; expiresAt: number; sentAt: number };

export function PhoneVerifyField({
  phone,
  onPhoneChange,
  verified,
  onVerified,
  label = "Mobile number",
  hint,
  whose = "them",
}: {
  phone: string;
  onPhoneChange: (formatted: string) => void;
  verified: VerifiedPhone | null;
  onVerified: (v: VerifiedPhone | null) => void;
  label?: string;
  hint?: string;
  /** Used in copy: "Enter the code we texted to …" / "Text {whose} a code". */
  whose?: string;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  React.useEffect(() => {
    if (state.status !== "sent" && state.status !== "verifying") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.status]);

  function changePhone(v: string) {
    onPhoneChange(formatPhone(v));
    if (verified) onVerified(null);
    if (state.status !== "idle") {
      setState({ status: "idle" });
      setCode("");
    }
    setError(null);
  }

  async function sendCode() {
    if (digitsOnly(phone).length !== 10) {
      setError("Enter a 10-digit US mobile number.");
      return;
    }
    setError(null);
    setState({ status: "sending" });
    try {
      const res = await fetch("/api/signup/phone/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not send code");
      setState({ status: "sent", expiresAt: json.expiresAt ?? Date.now() + 5 * 60_000, sentAt: Date.now() });
      setCode("");
    } catch (e) {
      setState({ status: "idle" });
      setError(e instanceof Error ? e.message : "Could not send code");
    }
  }

  async function verifyCode(c = code) {
    if (state.status !== "sent" || !/^\d{6}$/.test(c)) return;
    const prev = state;
    setState({ status: "verifying", expiresAt: prev.expiresAt, sentAt: prev.sentAt });
    setError(null);
    try {
      const res = await fetch("/api/signup/phone/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, code: c }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Invalid code");
      onVerified({ phone: json.phone, token: json.phoneToken });
      setState({ status: "idle" });
      setCode("");
    } catch (e) {
      setState(prev);
      setError(e instanceof Error ? e.message : "Invalid code");
    }
  }

  const pending = state.status === "sent" || state.status === "verifying";
  const secondsLeft = pending ? Math.max(0, Math.ceil((state.expiresAt - now) / 1000)) : 0;
  const resendIn = pending ? Math.max(0, 30 - Math.floor((now - state.sentAt) / 1000)) : 0;
  const isVerified = !!verified && digitsOnly(verified.phone).slice(-10) === digitsOnly(phone);

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label={label}
            type="tel"
            inputMode="tel"
            required
            placeholder="(555) 123-4567"
            value={phone}
            onChange={(e) => changePhone(e.target.value)}
            disabled={state.status === "sending" || state.status === "verifying"}
          />
        </div>
        {isVerified ? (
          <span className="inline-flex h-10 items-center gap-1.5 rounded-apple-sm bg-apple-green/10 px-3 text-apple-sm font-medium text-apple-green">
            <ShieldCheck className="h-4 w-4" /> Verified
          </span>
        ) : (
          <Button
            variant={state.status === "idle" ? "primary" : "secondary"}
            onClick={sendCode}
            loading={state.status === "sending"}
            disabled={digitsOnly(phone).length !== 10 || (state.status !== "idle" && resendIn > 0)}
          >
            {state.status === "idle" ? `Text ${whose} a code` : resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
          </Button>
        )}
      </div>
      {hint && !pending && <p className="text-apple-xs text-apple-text-tertiary">{hint}</p>}

      {pending && (
        <div className="rounded-apple border border-apple-blue/20 bg-apple-blue/5 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label={`Enter the code we texted to ${phone}`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(v);
                  if (v.length === 6) void verifyCode(v);
                }}
                className="text-center font-mono text-xl tracking-[0.4em]"
                autoFocus
              />
            </div>
            <Button onClick={() => verifyCode()} loading={state.status === "verifying"} disabled={code.length !== 6}>Verify</Button>
          </div>
          <p className="mt-2 text-apple-xs text-apple-text-tertiary">
            {secondsLeft > 0 ? `Code expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}.` : "That code has expired — request a new one."}
          </p>
        </div>
      )}
      {error && <p className="text-apple-sm text-apple-red">{error}</p>}
    </div>
  );
}
