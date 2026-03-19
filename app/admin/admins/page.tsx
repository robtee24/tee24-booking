// app/admin/admins/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-apple-2xl font-semibold tracking-tight text-apple-text">Admins</h1>
          <p className="mt-1 text-apple-base text-apple-text-secondary">
            Manage admin accounts and control access.
          </p>
        </div>
        <Link href="/admin/admins/new" className="btn-primary">
          + Add Admin
        </Link>
      </div>

      {loading ? (
        <div className="card p-6 text-apple-sm text-apple-text-tertiary">Loading…</div>
      ) : err ? (
        <div className="rounded-apple border border-apple-red/30 bg-apple-red/5 p-4 text-apple-sm text-apple-red">
          {err}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-apple-sm">
            <thead className="border-b border-apple-divider bg-apple-fill-secondary text-left">
              <tr>
                <th className="px-5 py-3 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">Phone</th>
                <th className="px-5 py-3 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">Name</th>
                <th className="px-5 py-3 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">Role</th>
                <th className="px-5 py-3 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">Locations</th>
                <th className="px-5 py-3 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">Created</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {(admins ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-apple-text-secondary">
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
                    <tr key={a.id || Math.random()} className="border-t border-apple-divider align-top transition-colors hover:bg-apple-fill-secondary/50">
                      <td className="px-5 py-3.5 font-mono text-apple-sm">{a.phone || "—"}</td>
                      <td className="px-5 py-3.5">{a.name ?? <span className="text-apple-text-tertiary">—</span>}</td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center rounded-apple-pill border border-apple-border px-2.5 py-0.5 text-apple-xs font-medium">
                          {a.role}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-apple-text-secondary">{locs}</td>
                      <td className="px-5 py-3.5 text-apple-text-tertiary">
                        {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-5 py-3.5 text-right">
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

      <div className="text-apple-xs text-apple-text-tertiary">
        admins: {(admins ?? []).length} · locations: {(locations ?? []).length}
      </div>
    </div>
  );
}

/* ========= Manage Modal ========= */

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
        className="rounded-apple-sm border border-apple-border px-3 py-1.5 text-apple-xs font-medium text-apple-text-secondary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text"
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
    if (!adminId) { setErr("missing id"); return; }
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
    if (!adminId) { setErr("missing id"); return; }
    try {
      setDeleting(true);
      const res = await fetch(`/api/admin/admins/${encodeURIComponent(adminId)}`, { method: "DELETE" });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-apple bg-white p-6 shadow-apple-lg">
        <div className="mb-4 text-apple-xs text-apple-text-tertiary">
          <span className="font-mono">Admin ID</span>:{" "}
          <span className="font-mono">{adminId || "—"}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Phone</label>
            <input className="input font-mono" value={admin?.phone ?? ""} disabled />
          </div>
          <div>
            <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="(optional)"
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Role</label>
            <select
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value as AdminRole)}
            >
              <option value="ROOT">ROOT</option>
              <option value="FULL">FULL</option>
              <option value="SCOPED">SCOPED</option>
            </select>
            <p className="mt-1.5 text-apple-xs text-apple-text-tertiary">
              ROOT and FULL access all locations. SCOPED limits access to selected locations.
            </p>
          </div>
        </div>

        {role === "SCOPED" && (
          <div className="mt-5">
            <div className="mb-2 text-apple-sm font-semibold text-apple-text">Allowed Locations</div>
            <div className="max-h-56 overflow-auto rounded-apple-sm border border-apple-border p-3">
              {(allLocations ?? []).length === 0 ? (
                <div className="text-apple-sm text-apple-text-tertiary">No locations.</div>
              ) : (
                (allLocations ?? []).map((loc) => {
                  const isChecked = checked.has(loc.id);
                  return (
                    <label key={loc.id} className="flex cursor-pointer items-center gap-3 rounded-apple-sm px-2 py-2 transition-colors hover:bg-apple-fill-secondary">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(loc.id)}
                        className="h-4 w-4 rounded accent-apple-blue"
                      />
                      <span className="text-apple-sm text-apple-text">{loc.name}</span>
                      <span className="rounded-apple-pill bg-apple-fill-secondary px-2 py-0.5 text-apple-xs text-apple-text-tertiary">
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
          <div className="mt-4 rounded-apple-sm border border-apple-red/30 bg-apple-red/5 px-4 py-2.5 text-apple-sm text-apple-red">
            {err}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-apple-divider pt-5">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <div className="flex items-center gap-2">
            <button
              className="btn-danger"
              onClick={onDelete}
              disabled={deleting || !adminId}
              title={!adminId ? "Missing id" : "Delete admin"}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button
              className="btn-primary"
              onClick={onSave}
              disabled={saving || !adminId}
              title={!adminId ? "Missing id" : "Save changes"}
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
