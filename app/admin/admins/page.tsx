// app/admin/admins/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

/* ===== Types ===== */
type AdminRole = "ROOT" | "FULL" | "SCOPED";
type LocationLite = { id: string; name: string; slug: string };
type AdminLocationLink = { id: string; location: LocationLite };
type AdminRow = {
  id: string;
  phone: string;
  name: string | null;
  role: AdminRole;
  createdAt: string;
  locations: AdminLocationLink[];
};

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export default function AdminsPage() {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [locations, setLocations] = useState<LocationLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setErr(null);
    try {
      const adminsResp = await fetchJSON<{ ok?: boolean; admins?: any[] }>("/api/admin/admins");
      const rawAdmins = Array.isArray(adminsResp?.admins) ? adminsResp.admins : [];

      const locResp = await fetchJSON<{ locations?: any[] }>("/api/admin/location-settings").catch(
        () => ({ locations: [] as any[] })
      );
      const rawLocs = Array.isArray(locResp?.locations) ? locResp.locations : [];

      const safeAdmins: AdminRow[] = rawAdmins.map((a: any) => ({
        id: String(a?.id ?? ""),
        phone: String(a?.phone ?? ""),
        name: a?.name ?? null,
        role: (a?.role as AdminRole) ?? "SCOPED",
        createdAt: new Date(a?.createdAt ?? Date.now()).toISOString(),
        locations: Array.isArray(a?.locations)
          ? a.locations
              .filter(Boolean)
              .map((l: any) => ({
                id: String(l?.id ?? ""),
                location: {
                  id: String(l?.location?.id ?? ""),
                  name: String(l?.location?.name ?? ""),
                  slug: String(l?.location?.slug ?? ""),
                },
              }))
          : [],
      }));

      const safeLocs: LocationLite[] = rawLocs.map((l: any) => ({
        id: String(l?.id ?? ""),
        name: String(l?.name ?? ""),
        slug: String(l?.slug ?? ""),
      }));

      setAdmins(safeAdmins);
      setLocations(safeLocs);
    } catch (e: any) {
      setErr(e?.message || "Failed to load admins");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await reload();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admins</h1>
        <Link
          href="/admin/admins/new"
          className="rounded-lg bg-black px-3 py-2 text-white hover:bg-neutral-800"
        >
          + Add Admin
        </Link>
      </div>

      {loading ? (
        <div className="rounded-xl border p-6 text-sm text-neutral-600">Loading…</div>
      ) : err ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {err}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium text-neutral-700">Phone</th>
                <th className="px-4 py-2 font-medium text-neutral-700">Name</th>
                <th className="px-4 py-2 font-medium text-neutral-700">Role</th>
                <th className="px-4 py-2 font-medium text-neutral-700">Locations</th>
                <th className="px-4 py-2 font-medium text-neutral-700">Created</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(admins ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-neutral-600">
                    No admins yet.
                  </td>
                </tr>
              ) : (
                (admins ?? []).map((a) => {
                  const locs =
                    a.role === "SCOPED"
                      ? (a.locations ?? [])
                          .map((l) => l?.location?.name)
                          .filter(Boolean)
                          .join(", ") || "None"
                      : "All locations";
                  return (
                    <tr key={a.id || Math.random()} className="border-t align-top">
                      <td className="px-4 py-3 font-mono">{a.phone || "—"}</td>
                      <td className="px-4 py-3">{a.name ?? <span className="text-neutral-500">—</span>}</td>
                      <td className="px-4 py-3">
                        <span className="rounded border px-2 py-0.5 text-xs">{a.role}</span>
                      </td>
                      <td className="px-4 py-3">{locs}</td>
                      <td className="px-4 py-3">
                        {a.createdAt ? new Date(a.createdAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ManageButton admin={a} allLocations={locations} onSaved={reload} onDeleted={reload} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 text-xs text-neutral-500">
        admins: {(admins ?? []).length} • locations: {(locations ?? []).length}
      </div>
    </div>
  );
}

/* ========= Manage Modal (client-only, defensive) ========= */

function ManageButton({
  admin,
  allLocations,
  onSaved,
  onDeleted,
}: {
  admin: AdminRow;
  allLocations: LocationLite[];
  onSaved: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="rounded-md border px-3 py-1 hover:bg-neutral-50"
        onClick={() => setOpen(true)}
      >
        Manage →
      </button>
      {open && (
        <ManageModal
          admin={admin}
          allLocations={allLocations}
          onClose={() => setOpen(false)}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}

function ManageModal({
  admin,
  allLocations,
  onClose,
  onSaved,
  onDeleted,
}: {
  admin: AdminRow;
  allLocations: LocationLite[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
}) {
  const adminId = admin?.id ?? "";
  const [name, setName] = useState<string>(admin?.name ?? "");
  const [role, setRole] = useState<AdminRole>(admin?.role ?? "SCOPED");
  const initiallyChecked = useMemo(
    () => new Set((admin?.locations ?? []).map((l) => l?.location?.id).filter(Boolean) as string[]),
    [admin]
  );
  const [checked, setChecked] = useState<Set<string>>(initiallyChecked);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (locId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(locId)) next.delete(locId);
      else next.add(locId);
      return next;
    });
  };

  const onSave = async () => {
    setErr(null);
    if (!adminId) {
      setErr("missing id");
      return;
    }
    try {
      setSaving(true);
      const payload: any = { name: name || null, role };
      if (role === "SCOPED") payload.locationIds = Array.from(checked);

      const res = await fetch(`/api/admin/admins/${encodeURIComponent(adminId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      await onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Server error");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    setErr(null);
    if (!adminId) {
      setErr("missing id");
      return;
    }
    try {
      setDeleting(true);
      const res = await fetch(`/api/admin/admins/${encodeURIComponent(adminId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      await onDeleted();
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Server error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 text-xs text-neutral-500">
          <span className="font-mono">Admin ID</span>:{" "}
          <span className="font-mono">{adminId || "—"}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-neutral-600">Phone</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2 font-mono"
              value={admin?.phone ?? ""}
              disabled
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600">Name</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="(optional)"
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-neutral-600">Role</label>
            <select
              className="mt-1 w-full rounded border px-3 py-2"
              value={role}
              onChange={(e) => setRole(e.target.value as AdminRole)}
            >
              <option value="ROOT">ROOT</option>
              <option value="FULL">FULL</option>
              <option value="SCOPED">SCOPED</option>
            </select>
            <p className="mt-1 text-xs text-neutral-500">
              ROOT and FULL access all locations. SCOPED limits access to selected locations.
            </p>
          </div>
        </div>

        {role === "SCOPED" && (
          <div className="mt-4">
            <div className="mb-1 text-sm font-semibold text-neutral-700">Allowed Locations</div>
            <div className="max-h-56 overflow-auto rounded border p-3">
              {(allLocations ?? []).length === 0 ? (
                <div className="text-sm text-neutral-500">No locations.</div>
              ) : (
                (allLocations ?? []).map((loc) => {
                  const isChecked = checked.has(loc.id);
                  return (
                    <label key={loc.id} className="flex cursor-pointer items-center gap-3 py-1">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(loc.id)}
                        className="h-4 w-4"
                      />
                      <span className="text-sm">{loc.name}</span>
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
                        {loc.slug}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}

        {err && (
          <div className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between">
          <button className="rounded border px-3 py-2 hover:bg-neutral-50" onClick={onClose}>
            Close
          </button>
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-red-300 bg-red-50 px-3 py-2 text-red-700 hover:bg-red-100 disabled:opacity-60"
              onClick={onDelete}
              disabled={deleting || !adminId}
              title={!adminId ? "Missing id" : "Delete admin"}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button
              className="rounded bg-black px-4 py-2 text-white hover:bg-neutral-800 disabled:opacity-60"
              onClick={onSave}
              disabled={saving || !adminId}
              title={!adminId ? "Missing id" : "Save changes"}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


