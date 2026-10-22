"use client";

import React, { useState } from "react";
import { Button, Card, CardHeader } from "@/components/ui";

export function SettingsClient({
  memberId,
  emailOptIn: initEmail,
  smsOptIn: initSms,
}: {
  memberId: string;
  emailOptIn: boolean;
  smsOptIn: boolean;
}) {
  const [emailOptIn, setEmailOptIn] = useState(initEmail);
  const [smsOptIn, setSmsOptIn] = useState(initSms);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function save() {
    setSaving(true);
    setDone(false);
    try {
      const res = await fetch("/api/portal/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optInEmailMarketing: emailOptIn, optInSmsMarketing: smsOptIn }),
      });
      if (res.ok) setDone(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Communication preferences" subtitle="You'll always get transactional emails about your account." />
      <div className="mt-4 space-y-3">
        <label className="flex items-start gap-2 text-apple-sm">
          <input type="checkbox" checked={emailOptIn} onChange={(e) => setEmailOptIn(e.target.checked)} className="mt-0.5 h-4 w-4 accent-apple-blue" />
          <span>Email me marketing offers and class news.</span>
        </label>
        <label className="flex items-start gap-2 text-apple-sm">
          <input type="checkbox" checked={smsOptIn} onChange={(e) => setSmsOptIn(e.target.checked)} className="mt-0.5 h-4 w-4 accent-apple-blue" />
          <span>Text me reminders & marketing offers (reply STOP to opt out).</span>
        </label>
        <div className="flex items-center gap-3 pt-2">
          <Button onClick={save} loading={saving}>Save preferences</Button>
          {done && <span className="text-apple-sm text-apple-green">Saved.</span>}
        </div>
      </div>
    </Card>
  );
}
