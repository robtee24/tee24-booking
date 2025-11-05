'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

type Bay = {
  id: string;
  number: number;
  name?: string | null;
  kind?: 'SINGLE' | 'GROUP';
  handedness?: 'RH' | 'LH' | null;
  capacity?: number;
};

type LocationDTO = {
  id: string;
  name: string;
  slug: string;
};

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready' };

// ---------- Helpers ----------
const onlyDigits = (s: string) => s.replace(/[^\d]/g, '');
const validNumericName = (s: string) => /^\d+$/.test(s);

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Build public bay view URL: /bay?id=<bayId>&d=<YYYY-MM-DD>
function buildBayViewUrl(origin: string, bayId: string, dateISO: string) {
  const params = new URLSearchParams({ id: bayId, d: dateISO });
  return `${origin}/bay?${params.toString()}`;
}

// Build location schedule URL: /schedule?slug=<locationSlug>
function buildScheduleUrl(origin: string, slug: string) {
  const params = new URLSearchParams({ slug });
  return `${origin}/schedule?${params.toString()}`;
}

// Convenience: fallback to window origin on client if NEXT_PUBLIC_BASE_URL isn’t set
function getOrigin() {
  if (typeof window !== 'undefined') return window.location.origin;
  return process.env.NEXT_PUBLIC_BASE_URL || '';
}

// robust clipboard
async function copyToClipboard(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

export default function BaysAdminPage() {
  // ✅ Do NOT put `| null` in the generic. Cast the untyped return instead.
  const rawParams = useParams() as { slug?: string } | null;
  const locationSlug = (rawParams?.slug ?? '').toString();

  const [location, setLocation] = useState<LocationDTO | null>(null);
  const [bays, setBays] = useState<Bay[]>([]);
  const [state, setState] = useState<FetchState>({ status: 'idle' });

  // Add form
  const [newNumber, setNewNumber] = useState<string>('');
  const [newName, setNewName] = useState<string>('');
  const [newKind, setNewKind] = useState<'SINGLE' | 'GROUP'>('GROUP');
  const [newHandedness, setNewHandedness] = useState<'RH' | 'LH'>('RH');
  const [newCapacity, setNewCapacity] = useState<string>('4');

  // Inline edits (per-bay)
  type EditForm = {
    number: string;               // string for input
    name: string;                 // digits or empty
    kind: 'SINGLE' | 'GROUP';
    handedness: 'RH' | 'LH' | ''; // '' when GROUP
    capacity: string;             // string for input
  };
  const [editing, setEditing] = useState<Record<string, EditForm>>({});

  // QR modal state
  const [qrBay, setQrBay] = useState<{ id: string; url: string; label: string } | null>(null);

  // copy feedback
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const origin = useMemo(getOrigin, []);
  const viewOrigin = process.env.NEXT_PUBLIC_BASE_URL || origin;
  const todayISO = useMemo(() => ymd(new Date()), []);

  async function load() {
    if (!locationSlug) return;
    try {
      setState({ status: 'loading' });
      const res = await fetch(`/api/admin/locations/${encodeURIComponent(String(locationSlug))}/bays`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || `Failed to load bays (${res.status})`);
      }
      setLocation(json.location);
      setBays(json.bays || []);
      setState({ status: 'ready' });
    } catch (e: any) {
      setState({ status: 'error', message: e?.message || 'Load failed' });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationSlug]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const num = Number(newNumber);
    if (!Number.isInteger(num) || num <= 0) {
      alert('Bay number must be a positive integer.');
      return;
    }
    if (newName && !validNumericName(newName)) {
      alert('Display name must be digits only (e.g., “1”, “2”, “10”).');
      return;
    }

    const payload: any = { number: num };
    if (newName) payload.name = newName;

    if (newKind === 'SINGLE') {
      payload.kind = 'SINGLE';
      payload.handedness = newHandedness;
      payload.capacity = 1;
    } else {
      payload.kind = 'GROUP';
      const cap = Number(newCapacity);
      if (!Number.isInteger(cap) || cap < 2) {
        alert('Capacity for GROUP bays must be an integer ≥ 2.');
        return;
      }
      payload.capacity = cap;
      payload.handedness = null;
    }

    try {
      const res = await fetch(`/api/admin/locations/${encodeURIComponent(String(locationSlug))}/bays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Create failed');
      // reset add form
      setNewNumber('');
      setNewName('');
      setNewKind('GROUP');
      setNewHandedness('RH');
      setNewCapacity('4');
      await load();
    } catch (e: any) {
      alert(e?.message || 'Create failed');
    }
  }

  function beginEdit(b: Bay) {
    setEditing((prev) => ({
      ...prev,
      [b.id]: {
        number: String(b.number ?? ''),
        name: b.name ? String(b.name) : '',
        kind: (b.kind ?? 'GROUP'),
        handedness: b.kind === 'SINGLE' ? (b.handedness ?? 'RH') : '',
        capacity: String(b.capacity ?? (b.kind === 'SINGLE' ? 1 : 4)),
      },
    }));
  }

  function cancelEdit(bayId: string) {
    setEditing((prev) => {
      const next = { ...prev };
      delete next[bayId];
      return next;
    });
  }

  async function saveEdit(b: Bay) {
    const form = editing[b.id];
    if (!form) return;

    const nextNumber = Number(form.number);
    if (!Number.isInteger(nextNumber) || nextNumber <= 0) {
      alert('Bay number must be a positive integer.');
      return;
    }

    const payload: any = {
      number: nextNumber,
      name: form.name ? form.name : null, // allow clearing
      kind: form.kind,
    };

    if (form.kind === 'SINGLE') {
      if (form.handedness !== 'RH' && form.handedness !== 'LH') {
        alert('Handedness is required for SINGLE bays.');
        return;
      }
      payload.handedness = form.handedness;
      payload.capacity = 1; // enforced
    } else {
      payload.handedness = null;
      const cap = Number(form.capacity);
      if (!Number.isInteger(cap) || cap < 2) {
        alert('Capacity for GROUP bays must be an integer ≥ 2.');
        return;
      }
      payload.capacity = cap;
    }

    try {
      const res = await fetch(
        `/api/admin/locations/${encodeURIComponent(String(locationSlug))}/bays/${encodeURIComponent(b.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Update failed');
      cancelEdit(b.id);
      await load();
    } catch (e: any) {
      alert(e?.message || 'Update failed');
    }
  }

  async function deleteBay(bay: Bay) {
    if (!confirm(`Delete Bay ${bay.number}${bay.name ? ` (${bay.name})` : ''}?`)) return;
    try {
      const res = await fetch(
        `/api/admin/locations/${encodeURIComponent(String(locationSlug))}/bays/${encodeURIComponent(bay.id)}`,
        { method: 'DELETE' }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Delete failed');
      await load();
    } catch (e: any) {
      alert(e?.message || 'Delete failed (note: future bookings will block deletion).');
    }
  }

  const scheduleUrl = location ? buildScheduleUrl(viewOrigin, location.slug) : '';

  // copy feedback timer
  function showCopied(key: string) {
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Bays</h1>
          <p className="text-sm text-gray-600">Manage bay numbers, names, kind, handedness, and capacity for this location.</p>
        </div>
        <div className="text-sm text-gray-500">
          {location ? (
            <span>
              Location: <span className="font-medium">{location.name}</span> ({location.slug})
            </span>
          ) : (
            <span>—</span>
          )}
        </div>
      </header>

      {/* Location Schedule (all bays) */}
      {location && (
        <section className="rounded-xl border p-5">
          <h2 className="mb-2 text-base font-semibold">Public schedule (all bays)</h2>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <a
              className="truncate text-blue-600 underline underline-offset-2"
              href={scheduleUrl}
              target="_blank"
              rel="noreferrer"
              title={scheduleUrl}
            >
              {scheduleUrl}
            </a>
            <button
              className="rounded border px-3 py-1.5 text-xs hover:bg-gray-50"
              onClick={async () => {
                const ok = await copyToClipboard(scheduleUrl);
                if (ok) showCopied('schedule');
              }}
              title="Copy link"
            >
              {copiedKey === 'schedule' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">Opens the full schedule for this location.</p>
        </section>
      )}

      {/* Add Bay */}
      <section className="rounded-xl border p-5">
        <h2 className="mb-3 text-base font-semibold">Add Bay</h2>
        <form onSubmit={handleAdd} className="grid grid-cols-1 gap-3 sm:grid-cols-5 sm:items-end">
          <div>
            <label className="block text-xs font-medium text-gray-700">Bay number</label>
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded border px-2 py-2"
              value={newNumber}
              onChange={(e) => setNewNumber(onlyDigits(e.target.value))}
              placeholder="e.g. 4"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700">Display name (digits only, optional)</label>
            <input
              type="text"
              className="mt-1 w-full rounded border px-2 py-2"
              value={newName}
              onChange={(e) => setNewName(onlyDigits(e.target.value))}
              placeholder="e.g. 4"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700">Kind</label>
            <select
              className="mt-1 w-full rounded border px-2 py-2"
              value={newKind}
              onChange={(e) => {
                const v = e.target.value as 'SINGLE' | 'GROUP';
                setNewKind(v);
                if (v === 'SINGLE') {
                  setNewCapacity('1');
                } else {
                  if (Number(newCapacity) < 2) setNewCapacity('4');
                }
              }}
            >
              <option value="SINGLE">SINGLE</option>
              <option value="GROUP">GROUP</option>
            </select>
          </div>

          {newKind === 'SINGLE' ? (
            <div>
              <label className="block text-xs font-medium text-gray-700">Handedness</label>
              <select
                className="mt-1 w-full rounded border px-2 py-2"
                value={newHandedness}
                onChange={(e) => setNewHandedness(e.target.value as 'RH' | 'LH')}
              >
                <option value="RH">RH</option>
                <option value="LH">LH</option>
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-700">Handedness</label>
              <input
                className="mt-1 w-full rounded border px-2 py-2 bg-gray-100 text-gray-500"
                value="—"
                disabled
                readOnly
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700">Capacity</label>
            {newKind === 'SINGLE' ? (
              <input
                className="mt-1 w-full rounded border px-2 py-2 bg-gray-100 text-gray-500"
                value="1"
                disabled
                readOnly
              />
            ) : (
              <input
                type="number"
                min={2}
                className="mt-1 w-full rounded border px-2 py-2"
                value={newCapacity}
                onChange={(e) => setNewCapacity(onlyDigits(e.target.value))}
              />
            )}
          </div>

          <div className="sm:col-span-5">
            <button
              type="submit"
              className="h-10 rounded bg-black px-4 text-sm font-medium text-white hover:opacity-90"
            >
              Add
            </button>
          </div>
        </form>
        <p className="mt-2 text-xs text-gray-500">
          SINGLE bays require handedness and are fixed at capacity 1. GROUP bays hide handedness and require capacity ≥ 2.
        </p>
      </section>

      {/* List / Edit Bays */}
      <section className="rounded-xl border p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Existing Bays</h2>
          <button onClick={load} className="rounded border px-3 py-1.5 text-xs hover:bg-gray-50">
            Refresh
          </button>
        </div>

        {state.status === 'loading' ? (
          <div className="text-sm text-gray-600">Loading…</div>
        ) : state.status === 'error' ? (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{state.message}</div>
        ) : bays.length === 0 ? (
          <div className="text-sm text-gray-600">No bays configured yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1040px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-16" />
                <col className="w-28" />
                <col className="w-24" />
                <col className="w-28" />
                <col className="w-20" />
                <col className="w-[360px]" />
                <col className="w-32" />
              </colgroup>
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="p-2 text-left font-medium">Bay #</th>
                  <th className="p-2 text-left font-medium">Display</th>
                  <th className="p-2 text-left font-medium">Kind</th>
                  <th className="p-2 text-left font-medium">Hand</th>
                  <th className="p-2 text-left font-medium">Cap</th>
                  <th className="p-2 text-left font-medium">Public link</th>
                  <th className="p-2 text-left font-medium" />
                </tr>
              </thead>
              <tbody>
                {bays.map((b) => {
                  const isEditing = !!editing[b.id];
                  const form = editing[b.id];
                  const url = buildBayViewUrl(viewOrigin, b.id, todayISO);
                  const label = `Bay ${b.number}${b.name ? ` (${b.name})` : ''}`;
                  const copyKey = `rowcopy-${b.id}`;

                  return (
                    <React.Fragment key={b.id}>
                      {/* Top row: fields + URL (with Copy/QR) */}
                      <tr className="border-b align-top">
                        {/* Number */}
                        <td className="p-2 align-middle w-16">
                          {!isEditing ? (
                            <span className="font-mono">{b.number}</span>
                          ) : (
                            <input
                              type="number"
                              min={1}
                              className="w-16 rounded border px-2 py-1"
                              value={form.number}
                              onChange={(e) =>
                                setEditing((prev) => ({
                                  ...prev,
                                  [b.id]: { ...prev[b.id], number: onlyDigits(e.target.value) },
                                }))
                              }
                            />
                          )}
                        </td>

                        {/* Name */}
                        <td className="p-2 align-middle w-28">
                          {!isEditing ? (
                            <span className="font-mono">{b.name ?? '—'}</span>
                          ) : (
                            <input
                              type="text"
                              className="w-24 rounded border px-2 py-1"
                              value={form.name}
                              onChange={(e) =>
                                setEditing((prev) => ({
                                  ...prev,
                                  [b.id]: { ...prev[b.id], name: onlyDigits(e.target.value) },
                                }))
                              }
                              placeholder="digits"
                            />
                          )}
                        </td>

                        {/* Kind */}
                        <td className="p-2 align-middle w-24">
                          {!isEditing ? (
                            <span>{b.kind ?? 'GROUP'}</span>
                          ) : (
                            <select
                              className="w-24 rounded border px-2 py-1"
                              value={form.kind}
                              onChange={(e) => {
                                const nextKind = e.target.value as 'SINGLE' | 'GROUP';
                                setEditing((prev) => {
                                  const cur = prev[b.id];
                                  if (!cur) return prev;
                                  return {
                                    ...prev,
                                    [b.id]: {
                                      ...cur,
                                      kind: nextKind,
                                      handedness: nextKind === 'SINGLE' ? (cur.handedness || 'RH') : '',
                                      capacity: nextKind === 'SINGLE' ? '1' : (Number(cur.capacity) < 2 ? '4' : cur.capacity),
                                    },
                                  };
                                });
                              }}
                            >
                              <option value="SINGLE">SINGLE</option>
                              <option value="GROUP">GROUP</option>
                            </select>
                          )}
                        </td>

                        {/* Handedness */}
                        <td className="p-2 align-middle w-28">
                          {(!isEditing && (b.kind ?? 'GROUP') === 'GROUP') ? (
                            <span>—</span>
                          ) : isEditing ? (
                            form.kind === 'SINGLE' ? (
                              <select
                                className="w-24 rounded border px-2 py-1"
                                value={form.handedness}
                                onChange={(e) =>
                                  setEditing((prev) => ({
                                    ...prev,
                                    [b.id]: { ...prev[b.id], handedness: e.target.value as 'RH' | 'LH' },
                                  }))
                                }
                              >
                                <option value="RH">RH</option>
                                <option value="LH">LH</option>
                              </select>
                            ) : (
                              <span>—</span>
                            )
                          ) : (
                            <span>{b.handedness ?? '—'}</span>
                          )}
                        </td>

                        {/* Capacity */}
                        <td className="p-2 align-middle w-24">
                          {!isEditing ? (
                            <span>{b.capacity ?? ((b.kind ?? 'GROUP') === 'SINGLE' ? 1 : 4)}</span>
                          ) : form.kind === 'SINGLE' ? (
                            <input
                              className="w-16 rounded border px-2 py-1 bg-gray-100 text-gray-500"
                              value="1"
                              disabled
                              readOnly
                            />
                          ) : (
                            <input
                              type="number"
                              min={2}
                              className="w-16 rounded border px-2 py-1"
                              value={form.capacity}
                              onChange={(e) =>
                                setEditing((prev) => ({
                                  ...prev,
                                  [b.id]: { ...prev[b.id], capacity: onlyDigits(e.target.value) },
                                }))
                              }
                            />
                          )}
                        </td>

                        {/* Public link + copy + qr */}
                        <td className="p-2 align-middle">
                          <div className="flex flex-wrap items-center gap-2">
                            <a
                              className="max-w-[420px] truncate text-blue-600 underline underline-offset-2"
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              title={url}
                            >
                              {url}
                            </a>
                            <button
                              className="rounded border px-3 py-1.5 text-xs hover:bg-gray-50"
                              onClick={async () => {
                                const ok = await copyToClipboard(url);
                                if (ok) showCopied(copyKey);
                              }}
                            >
                              {copiedKey === copyKey ? 'Copied!' : 'Copy'}
                            </button>
                            <button
                              className="rounded border px-3 py-1.5 text-xs hover:bg-gray-50"
                              onClick={() =>
                                setQrBay({
                                  id: b.id,
                                  url,
                                  label: label,
                                })
                              }
                            >
                              QR
                            </button>
                          </div>
                        </td>

                        {/* empty header companion cell for alignment */}
                        <td className="p-2" />
                      </tr>

                      {/* Second row: Bay ID (left) + Actions (right) */}
                      <tr className="border-b bg-gray-50/40">
                        <td className="p-2 text-[11px] text-gray-600" colSpan={4}>
                          <div className="font-mono break-all">ID: {b.id}</div>
                        </td>
                        <td className="p-2" colSpan={3}>
                          <div className="flex items-center justify-end gap-2">
                            {!isEditing ? (
                              <>
                                <button
                                  className="rounded border px-3 py-1.5 text-xs hover:bg-gray-50"
                                  onClick={() => beginEdit(b)}
                                >
                                  Edit
                                </button>
                                <button
                                  className="rounded border border-red-400 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
                                  onClick={() => deleteBay(b)}
                                >
                                  Delete
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="rounded bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                                  onClick={() => saveEdit(b)}
                                >
                                  Save
                                </button>
                                <button
                                  className="rounded border px-3 py-1.5 text-xs hover:bg-gray-50"
                                  onClick={() => cancelEdit(b.id)}
                                >
                                  Cancel
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* QR Modal */}
      {qrBay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setQrBay(null)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-3 text-lg font-semibold">QR Code — {qrBay.label}</h3>
            <div className="flex flex-col items-center gap-3">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrBay.url)}`}
                alt="QR code"
                className="h-[240px] w-[240px] rounded border bg-white"
              />
              <div className="w-full truncate text-center text-xs text-gray-600">{qrBay.url}</div>
              <div className="mt-2 flex gap-2">
                <button
                  className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={async () => {
                    const ok = await copyToClipboard(qrBay.url);
                    if (ok) showCopied('qrmodal');
                  }}
                >
                  {copiedKey === 'qrmodal' ? 'Copied!' : 'Copy link'}
                </button>
                <button
                  className="rounded bg-black px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(qrBay.url)}`;
                    a.download = `${qrBay.label.replace(/\s+/g, '-')}.png`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  }}
                >
                  Download PNG
                </button>
                <button
                  className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={() => setQrBay(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



