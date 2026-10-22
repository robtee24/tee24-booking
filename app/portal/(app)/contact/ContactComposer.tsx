"use client";

import React, { useState } from "react";
import { Button, Card, CardHeader, Input, Select, Textarea } from "@/components/ui";

const QUICK_LINKS = [
  { id: "update_payment", label: "Update payment method" },
  { id: "request_freeze", label: "Request to freeze membership" },
  { id: "request_cancel", label: "Request to cancel membership" },
  { id: "request_refund", label: "Request a refund" },
  { id: "door_issue", label: "Door access not working" },
  { id: "update_info", label: "Update my contact info" },
];

export function ContactComposer() {
  const [topic, setTopic] = useState<string>("general");
  const [channel, setChannel] = useState<"EMAIL" | "SMS">("EMAIL");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, channel, subject, body }),
      });
      if (!res.ok) throw new Error(await res.text());
      setDone(true);
      setSubject("");
      setBody("");
    } catch (e: any) {
      setError(e.message ?? "Failed to send");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Send us a message" subtitle="We typically reply within one business day." />

      <div className="mt-4 flex flex-wrap gap-2">
        {QUICK_LINKS.map((q) => (
          <button
            key={q.id}
            type="button"
            onClick={() => {
              setTopic(q.id);
              setSubject(q.label);
            }}
            className={`rounded-full border px-3 py-1 text-apple-xs ${
              topic === q.id
                ? "border-apple-blue bg-apple-blue text-white"
                : "border-apple-border bg-white text-apple-text-secondary hover:border-apple-blue/40"
            }`}
          >
            {q.label}
          </button>
        ))}
      </div>

      <form onSubmit={send} className="mt-5 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Select label="Channel" value={channel} onChange={(e) => setChannel(e.target.value as any)}>
            <option value="EMAIL">Email</option>
            <option value="SMS">Text</option>
          </Select>
          <div className="sm:col-span-2">
            <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
          </div>
        </div>
        <Textarea label="Message" rows={5} value={body} onChange={(e) => setBody(e.target.value)} required />
        {error && <p className="text-apple-sm text-apple-red">{error}</p>}
        {done && <p className="text-apple-sm text-apple-green">Message sent. We'll be in touch soon.</p>}
        <div className="flex justify-end">
          <Button type="submit" loading={submitting}>Send</Button>
        </div>
      </form>
    </Card>
  );
}
