'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type LocationRow = {
  id: string;
  name: string;
  slug: string;
  disabled?: boolean;
};

export default function LocationsIndexPage() {
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // create form state
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  // action state
  const [actionSlug, setActionSlug] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      setErr(null);
      const res = await fetch('/api/admin/location-settings', { cache: 'no-store' });
      if (!res.ok) throw await errorFromResponse(res, 'Failed to load locations');
      const json = await res.json();
      const locations: LocationRow[] = (json?.locations ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        disabled: r.disabled ?? false,
      }));
      setRows(locations);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load locations');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => { await load(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) {
      setCreateErr('Name and slug are required');
      return;
    }
    try {
      setCreating(true);
      setCreateErr(null);
      const res = await fetch('/api/admin/locations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim().toLowerCase(),
        }),
      });
      if (!res.ok) throw await errorFromResponse(res, 'Failed to create location');
      setName('');
      setSlug('');
      await load();
    } catch (e: any) {
      setCreateErr(e?.message ?? 'Failed to create location');
    } finally {
      setCreating(false);
    }
  }

  async function toggleDisabled(slug: string, nextDisabled: boolean) {
    try {
      setActionErr(null);
      setActionSlug(slug);
      const res = await fetch(`/api/admin/locations/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ disabled: nextDisabled }),
      });
      if (!res.ok) throw await errorFromResponse(res, 'Failed to update location');
      await load();
    } catch (e: any) {
      setActionErr(e?.message ?? 'Failed to update location');
    } finally {
      setActionSlug(null);
    }
  }

  async function deleteLocation(slug: string) {
    const sure = window.confirm(
      `Delete location "${slug}"?\n\nThis will fail if bays/bookings exist.\nThis action cannot be undone.`
    );
    if (!sure) return;
    try {
      setActionErr(null);
      setActionSlug(slug);
      const res = await fetch(`/api/admin/locations/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw await errorFromResponse(res, 'Failed to delete location');
      await load();
    } catch (e: any) {
      setActionErr(e?.message ?? 'Failed to delete location');
    } finally {
      setActionSlug(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Locations</h1>
          <p className="text-sm text-gray-600">
            Select a location to manage details, bays, notifications, and bookings.
          </p>
        </div>
      </header>

      {/* Create form */}
      <section className="rounded-xl border bg-white p-4">
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-64 rounded border px-2 py-1.5"
              placeholder="Tee24 Clarksville"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="w-56 rounded border px-2 py-1.5"
              placeholder="clarksville"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded bg-gray-900 px-3 py-2 text-white disabled:opacity-60"
          >
            {creating ? 'Creating…' : 'Create Location'}
          </button>

          {createErr && <div className="text-sm text-red-600">{createErr}</div>}
        </form>
      </section>

      {/* List */}
      {loading ? (
        <div className="rounded-xl border p-6 text-sm text-gray-500">Loading…</div>
      ) : err ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {err}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border p-6 text-sm text-gray-600">No locations yet.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
                <th className="px-4 py-3">Danger</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-gray-700">{r.slug}</td>
                  <td className="px-4 py-3">
                    {r.disabled ? (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">
                        Disabled
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                        Enabled
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/admin/locations/${r.slug}`}
                        className="rounded border px-2 py-1 hover:bg-gray-50"
                      >
                        Details
                      </Link>
                      <Link
                        href={`/admin/locations/${r.slug}/bays`}
                        className="rounded border px-2 py-1 hover:bg-gray-50"
                      >
                        Bays
                      </Link>
                      <Link
                        href={`/admin/locations/${r.slug}/notifications`}
                        className="rounded border px-2 py-1 hover:bg-gray-50"
                      >
                        Notifications
                      </Link>
                      <Link
                        href={`/admin/locations/${r.slug}/bookings`}
                        className="rounded border px-2 py-1 hover:bg-gray-50"
                      >
                        Bookings
                      </Link>
                    </div>
                  </td>

                  {/* Danger column: Enable/Disable + Delete */}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => toggleDisabled(r.slug, !r.disabled)}
                        disabled={actionSlug === r.slug}
                        className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                        title={r.disabled ? 'Enable location' : 'Disable location'}
                      >
                        {actionSlug === r.slug
                          ? 'Saving…'
                          : r.disabled
                          ? 'Enable'
                          : 'Disable'}
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteLocation(r.slug)}
                        disabled={actionSlug === r.slug}
                        className="rounded border border-red-300 bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100 disabled:opacity-60"
                        title="Delete location"
                      >
                        {actionSlug === r.slug ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {actionErr && (
            <div className="border-t bg-amber-50 p-3 text-sm text-amber-800">
              {actionErr}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ===== Helpers ===== */
async function errorFromResponse(res: Response, fallback: string) {
  try {
    const text = await res.text();
    return new Error(`${fallback} (${res.status}): ${text || res.statusText}`);
  } catch {
    return new Error(`${fallback} (${res.status})`);
  }
}



