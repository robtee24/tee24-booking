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

  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

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
      <header>
        <h1 className="text-apple-2xl font-semibold tracking-tight text-apple-text">Locations</h1>
        <p className="mt-1 text-apple-base text-apple-text-secondary">
          Select a location to manage details, bays, notifications, and bookings.
        </p>
      </header>

      {/* Create form */}
      <section className="card p-5">
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input w-64"
              placeholder="Tee24 Clarksville"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="input w-56"
              placeholder="clarksville"
            />
          </div>
          <button type="submit" disabled={creating} className="btn-primary">
            {creating ? 'Creating…' : 'Create Location'}
          </button>
          {createErr && <div className="text-apple-sm text-apple-red">{createErr}</div>}
        </form>
      </section>

      {/* List */}
      {loading ? (
        <div className="card p-6 text-apple-sm text-apple-text-tertiary">Loading…</div>
      ) : err ? (
        <div className="rounded-apple border border-apple-red/30 bg-apple-red/5 p-4 text-apple-sm text-apple-red">
          {err}
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-apple-sm text-apple-text-secondary">No locations yet.</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full text-apple-sm">
            <thead className="border-b border-apple-divider bg-apple-fill-secondary text-left">
              <tr>
                <th className="px-5 py-3 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">Name</th>
                <th className="px-5 py-3 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">Slug</th>
                <th className="px-5 py-3 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">Status</th>
                <th className="px-5 py-3 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">Actions</th>
                <th className="px-5 py-3 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">Danger</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-apple-divider transition-colors hover:bg-apple-fill-secondary/50">
                  <td className="px-5 py-3.5 font-medium text-apple-text">{r.name}</td>
                  <td className="px-5 py-3.5 font-mono text-apple-sm text-apple-text-secondary">{r.slug}</td>
                  <td className="px-5 py-3.5">
                    {r.disabled ? (
                      <span className="inline-flex items-center rounded-apple-pill bg-apple-red/10 px-2.5 py-0.5 text-apple-xs font-medium text-apple-red">
                        Disabled
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-apple-pill bg-apple-green/10 px-2.5 py-0.5 text-apple-xs font-medium text-apple-green">
                        Enabled
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1.5">
                      {['Details', 'Bays', 'Notifications', 'Bookings'].map((label) => {
                        const path = label === 'Details' ? '' : `/${label.toLowerCase()}`;
                        return (
                          <Link
                            key={label}
                            href={`/admin/locations/${r.slug}${path}`}
                            className="rounded-apple-sm border border-apple-border px-2.5 py-1 text-apple-xs font-medium text-apple-text-secondary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text"
                          >
                            {label}
                          </Link>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleDisabled(r.slug, !r.disabled)}
                        disabled={actionSlug === r.slug}
                        className="rounded-apple-sm border border-apple-orange/30 bg-apple-orange/5 px-2.5 py-1 text-apple-xs font-medium text-apple-orange transition-colors hover:bg-apple-orange/10 disabled:opacity-50"
                        title={r.disabled ? 'Enable location' : 'Disable location'}
                      >
                        {actionSlug === r.slug ? 'Saving…' : r.disabled ? 'Enable' : 'Disable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteLocation(r.slug)}
                        disabled={actionSlug === r.slug}
                        className="rounded-apple-sm border border-apple-red/30 bg-apple-red/5 px-2.5 py-1 text-apple-xs font-medium text-apple-red transition-colors hover:bg-apple-red/10 disabled:opacity-50"
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
            <div className="border-t border-apple-divider bg-apple-orange/5 p-3 text-apple-sm text-apple-orange">
              {actionErr}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

async function errorFromResponse(res: Response, fallback: string) {
  try {
    const text = await res.text();
    return new Error(`${fallback} (${res.status}): ${text || res.statusText}`);
  } catch {
    return new Error(`${fallback} (${res.status})`);
  }
}
