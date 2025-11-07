// app/admin/login/page.tsx
"use client";
import React from "react";

// --- helper: normalize phone numbers to E.164 ---
function toE164(input: string): string | null {
  const digits = (input || "").replace(/\D/g, ""); // keep digits only
  if (digits.length === 10) return `+1${digits}`; // standard US
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (input.trim().startsWith("+") && digits.length >= 10) return input.trim();
  return null;
}

export default function AdminLoginPage() {
  const [step, setStep] = React.useState<"phone" | "code">("phone");
  const [phoneInput, setPhoneInput] = React.useState("");
  const [phoneE164, setPhoneE164] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  // --- request OTP ---
  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setMsg(null);

    const normalized = toE164(phoneInput);
    if (!normalized) {
      setMsg("Please enter a valid phone number (e.g., 123-456-7890).");
      return;
    }

    setPhoneE164(normalized);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalized }),
      });

      const contentType = res.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await res.json()
        : { error: await res.text() };

      if (!res.ok) throw new Error(payload?.error || "Failed to send code");

      setStep("code");
      setMsg("Code sent. Check your text messages.");
    } catch (err: any) {
      setMsg(err?.message || "Failed to send code");
    } finally {
      setLoading(false);
    }
  }

  // --- verify OTP & set session cookie ---
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setMsg(null);

    const digits = (code || "").replace(/\D/g, "");
    if (!/^\d{6}$/.test(digits)) {
      setMsg("Please enter the 6-digit code.");
      return;
    }
    if (!phoneE164) {
      setMsg("Please re-enter your phone number.");
      setStep("phone");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneE164, code: digits }),
      });

      const contentType = res.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await res.json()
        : { error: await res.text() };

      if (!res.ok) throw new Error(payload?.error || "Verification failed");

      // success → cookie set server-side → go to admin
      window.location.href = "/admin";
    } catch (err: any) {
      setMsg(err?.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-neutral-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold">Tee24 Admin Login</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Enter your phone to receive a one-time code.
        </p>

        {msg && (
          <div className="mt-3 rounded-lg border bg-neutral-50 p-2 text-sm">
            {msg}
          </div>
        )}

        {step === "phone" && (
          <form onSubmit={start} className="mt-4 space-y-3">
            <label className="block text-sm">Phone</label>
            <input
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="123-456-7890"
              className="w-full rounded-xl border px-3 py-2"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-black px-3 py-2 text-white disabled:opacity-60"
            >
              {loading ? "Sending..." : "Send Code"}
            </button>
            <p className="text-xs text-neutral-500">
              We’ll normalize formats like (123) 456-7890 or 1234567890 automatically.
            </p>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={verify} className="mt-4 space-y-3">
            <label className="block text-sm">6-digit Code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="123456"
              className="w-full rounded-xl border px-3 py-2"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-black px-3 py-2 text-white disabled:opacity-60"
            >
              {loading ? "Verifying..." : "Verify & Continue"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={start}
              className="w-full rounded-xl border px-3 py-2"
            >
              Resend Code
            </button>
            <div className="text-xs text-neutral-500">
              Sent to <b>{phoneE164 ?? ""}</b>
            </div>
          </form>
        )}

        <div className="mt-6 text-center text-xs text-neutral-500">
          Access restricted to registered admin numbers.
        </div>
      </div>
    </div>
  );
}

