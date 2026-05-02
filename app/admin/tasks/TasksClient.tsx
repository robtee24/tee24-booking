"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, Input, Select, Textarea } from "@/components/ui";

type Admin = { id: string; name: string | null; phone: string };
type Location = { id: string; name: string; slug: string };

export function TasksClient({
  tasks: _tasks,
  admins,
  locations,
}: {
  tasks: any[];
  admins: Admin[];
  locations: Location[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [priority, setPriority] = useState("NORMAL");
  const [dueAt, setDueAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, assignedToId, locationId, priority, dueAt: dueAt || null }),
      });
      if (res.ok) {
        setTitle("");
        setBody("");
        setDueAt("");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader title="New task" />
      <form onSubmit={add} className="mt-4 space-y-3">
        <Input label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea label="Notes" rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Select label="Assignee" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
            <option value="">— Unassigned —</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>{a.name ?? a.phone}</option>
            ))}
          </Select>
          <Select label="Location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
          </Select>
          <Input label="Due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={submitting}>Add task</Button>
        </div>
      </form>
    </Card>
  );
}
