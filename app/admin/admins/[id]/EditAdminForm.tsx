"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Role = "SCOPED" | "FULL" | "ROOT";
type Loc = { id: string; name: string };

export default function EditAdminForm(props: {
  adminId: string;
  initialName: string;
  initialRole: Role;
  allLocations: Loc[];
  initialLocationIds: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState(props.initialName || "");
  const [role, setRole] = useState<Role>(props.initialRole);
  const [locIds, setLocIds] = useState<string[]>(props.initialLocationIds);
  const [saving, setSaving] = useState(false);

  function toggle(id: string) {
    setLocIds((prev) => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/admin/admins/${props.adminId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || null,
        role,
        locationIds: role === "SCOPED" ? locIds : [],
      }),
    });
    setSaving(false);
    if (res.ok) {
      router.refresh();
      alert("Saved.");
    } else {
      const j = await res.json().catch(() => ({} as any));
      alert(j?.error || "Failed to save.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border bg-white p-4 space-y-4 max-w-xl">
      <div>
        <label className="block text-sm font-medium">Name</label>
        <input
          className="mt-1 w-full rounded-md border p-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Optional"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Role</label>
        <select
          className="mt-1 w-full rounded-md border p-2"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          <option value="SCOPED">Scoped (specific locations)</option>
          <option value="FULL">Full (all locations)</option>
          <option value="ROOT">Root (manage admins)</option>
        </select>
      </div>

      {role === "SCOPED" && (
        <div>
          <label className="block text-sm font-medium">Locations</label>
          <div className="mt-2 grid grid-cols-1 gap-1 rounded-md border p-2 sm:grid-cols-2">
            {props.allLocations.map((l) => (
              <label key={l.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={locIds.includes(l.id)}
                  onChange={() => toggle(l.id)}
                />
                {l.name}
              </label>
            ))}
            {props.allLocations.length === 0 && (
              <div className="text-sm text-neutral-500">No locations yet.</div>
            )}
          </div>
        </div>
      )}

      <button
        disabled={saving}
        className="rounded-md bg-black px-4 py-2 text-white hover:bg-neutral-800 disabled:opacity-60"
      >
        {saving ? "Saving..." : "Save Changes"}
      </button>
    </form>
  );
}
