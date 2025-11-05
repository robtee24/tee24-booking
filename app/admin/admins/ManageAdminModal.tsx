"use client";

import { useEffect, useState } from "react";
import type { AdminRole } from "@prisma/client";

type AdminLite = {
  id: string;
  phone: string;
  name: string | null;
  role: AdminRole;
  locationSlugs: string[];
};

type LocLite = { id: string; name: string; slug: string };

export default function ManageAdminModal({
  admin,
  allLocations,
}: {
  admin: AdminLite;
  allLocations: LocLite[];
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<AdminRole>(admin.role);
  const [name, setName] = useState<string>(admin.name ?? "");
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>(admin.locationSlugs ?? []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRole(admin.role);
      setName(admin.name ?? "");
      setSelectedSlugs(admin.locationSlugs ?? []);
      setErr(null);
    }
  }, [open, admin]);

  const toggleSlug = (slug: string) =>
    setSelectedSlugs((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));

  async function saveChanges() {
    setSaving(true);
    setErr(null);
    try {
      const body: any = { role, name };
      if (role === "SCOPED") body.locationSlugs = selectedSlugs;

      const res = await fetch(`/api/admin/admins/${admin.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        const msg = json?.message || json?.error || `HTTP ${res.status}`;
        setErr(msg);
        return;
      }
      window.location.reload();
    } catch (e: any) {
      setErr(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAdmin() {
    if (!confirm("Delete this admin?")) return;
    setDeleting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/admins/${admin.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        const msg = json?.message || json?.error || `HTTP ${res.status}`;
        setErr(msg);
        setDeleting(false);
        return;
      }
      window.location.reload();
    } catch (e: any) {
      setErr(e?.message || "Failed to delete");
      setDeleting(false);
    }
  }

  const scoped = role === "SCOPED";

  return (
    <>
      <button className="rounded-md border px-3 py-1 hover:bg-neutral-50" onClick={() => setOpen(true)}>
        Manage →
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Manage Admin</h2>
              <button
                className="rounded px-2 py-1 text-sm hover:bg-neutral-100"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-3 items-center gap-3">
                <div className="text-sm text-neutral-600">Phone</div>
                <div className="col-span-2 font-mono text-sm">{admin.phone}</div>
              </div>

              <div className="grid grid-cols-3 items-center gap-3">
                <label className="text-sm text-neutral-600">Name</label>
                <input
                  className="col-span-2 w-full rounded border px-2 py-1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-3 items-center gap-3">
                <label className="text-sm text-neutral-600">Role</label>
                <select
                  className="col-span-2 w-full rounded border px-2 py-1"
                  value={role}
                  onChange={(e) => setRole(e.target.value as AdminRole)}
                >
                  <option value="ROOT">ROOT</option>
                  <option value="FULL">FULL</option>
                  <option value="SCOPED">SCOPED</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="text-sm text-neutral-600">Locations</div>
                <div className="col-span-2 space-y-1 rounded border p-2">
                  {allLocations.map((loc) => (
                    <label key={loc.slug} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={!scoped}
                        checked={selectedSlugs.includes(loc.slug)}
                        onChange={() => toggleSlug(loc.slug)}
                      />
                      <span className={!scoped ? "text-neutral-400" : ""}>{loc.name}</span>
                    </label>
                  ))}
                  {!scoped && (
                    <div className="pt-1 text-xs text-neutral-500">
                      Selectable only when role is <strong>SCOPED</strong>.
                    </div>
                  )}
                </div>
              </div>

              {err && <div className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{err}</div>}
            </div>

            <div className="mt-5 flex items-center justify-between">
              <button
                onClick={deleteAdmin}
                disabled={deleting}
                className="rounded border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete Admin"}
              </button>

              <button
                onClick={saveChanges}
                disabled={saving}
                className="rounded bg-black px-3 py-1.5 text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}




