"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, Select, Textarea } from "@/components/ui";

export function MaintenanceComposer({
  locationId,
  bays,
}: {
  locationId: string;
  bays: Array<{ id: string; number: number }>;
}) {
  const router = useRouter();
  const [bayId, setBayId] = useState("");
  const [kind, setKind] = useState("ISSUE");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, bayId: bayId || null, kind, body }),
      });
      if (res.ok) {
        setBody("");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader title="New entry" />
      <form onSubmit={add} className="mt-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Bay" value={bayId} onChange={(e) => setBayId(e.target.value)}>
            <option value="">— General (location) —</option>
            {bays.map((b) => <option key={b.id} value={b.id}>Bay {b.number}</option>)}
          </Select>
          <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="ISSUE">Issue</option>
            <option value="RESOLVED">Resolved</option>
            <option value="INSPECTION">Inspection</option>
            <option value="NOTE">Note</option>
          </Select>
        </div>
        <Textarea label="Notes" required rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex justify-end">
          <Button type="submit" loading={submitting}>Add entry</Button>
        </div>
      </form>
    </Card>
  );
}
