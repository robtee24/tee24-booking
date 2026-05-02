"use client";

import React, { useState } from "react";
import { Button, Card, CardHeader, Input } from "@/components/ui";

export default function PortalLoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/auth/magic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSent(true);
    } catch (err: any) {
      setError(err.message ?? "Failed to send link");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-apple-bg">
      <div className="mx-auto max-w-md px-4 py-16">
        <h1 className="mb-6 text-center text-apple-2xl font-semibold tracking-tight">Sign in</h1>
        <Card>
          <CardHeader title="Member sign-in" subtitle="We'll email you a one-tap login link." />
          {sent ? (
            <p className="mt-4 text-apple-sm text-apple-text">
              If an account exists for <strong>{email}</strong>, a sign-in link is on its way.
            </p>
          ) : (
            <form onSubmit={send} className="mt-4 space-y-4">
              <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              {error && <p className="text-apple-sm text-apple-red">{error}</p>}
              <Button type="submit" loading={submitting} className="w-full">Send sign-in link</Button>
            </form>
          )}
        </Card>
        <p className="mt-4 text-center text-apple-xs text-apple-text-tertiary">
          By signing in you agree to our terms of service.
        </p>
      </div>
    </div>
  );
}
