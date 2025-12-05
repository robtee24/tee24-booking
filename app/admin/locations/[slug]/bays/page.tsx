'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { BayInfo } from '@/types/bay';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const onlyDigits = (s: string) => s.replace(/[^\d]/g, '');
const validNumericName = (s: string) => /^\d+$/.test(s);

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildBayViewUrl(origin: string, bayId: string, dateISO: string) {
  const params = new URLSearchParams({ id: bayId, d: dateISO });
  return `${origin}/bay?${params.toString()}`;
}

function buildScheduleUrl(origin: string, slug: string) {
  const params = new URLSearchParams({ slug });
  return `${origin}/schedule?${params.toString()}`;
}

function getOrigin() {
  if (typeof window !== 'undefined') return window.location.origin;
  return process.env.NEXT_PUBLIC_BASE_URL || '';
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function BaysAdminPage() {
  const rawParams = useParams() as { slug?: string } | null;
  const locationSlug = (rawParams?.slug ?? '').toString();

  const [location, setLocation] = useState<{ id: string; name: string; slug: string } | null>(null);
  const [bays, setBays] = useState<BayInfo[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Add form
  const [newNumber, setNewNumber] = useState('');
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<'SINGLE' | 'GROUP'>('GROUP');
  const [newHandedness, setNewHandedness] = useState<'RH' | 'LH'>('RH');
  const [newCapacity, setNewCapacity] = useState('4');
  const [newDisabled, setNewDisabled] = useState(false);

  // Edit form state
  type EditForm = {
    number: string;
    name: string;
    kind: 'SINGLE' | 'GROUP';
    handedness: 'RH' | 'LH' | '';
    capacity: string;
    disabled: boolean;
  };
  const [editing, setEditing] = useState<Record<string, EditForm>>({});

  const [qrBay, setQrBay] = useState<{ id: string; url: string; label: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const origin = useMemo(getOrigin, []);
  const viewOrigin = process.env.NEXT_PUBLIC_BASE_URL || origin;
  const todayISO = useMemo(() => ymd(new Date()), []);

  async function load() {
    if (!locationSlug) return;
    try {
      setState('loading');
      const res = await fetch(`/api/admin/locations/${encodeURIComponent(locationSlug)}/bays`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `Failed (${res.status})`);
      setLocation(json.location);
      setBays(json.bays || []);
      setState('ready');
    } catch (e: any) {
      setErrorMsg(e?.message || 'Load failed');
      setState('error');
    }
  }

  useEffect(() => {
    load();
  }, [locationSlug]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const num = Number(newNumber);
    if (!Number.isInteger(num) || num <= 0) return alert('Bay number must be a positive integer.');
    if (newName && !validNumericName(newName)) return alert('Display name must be digits only.');

    const payload: any = {
      number: num,
      name: newName || null,
      kind: newKind,
      disabled: newDisabled,
    };

    if (newKind === 'SINGLE') {
      payload.handedness = newHandedness;
      payload.capacity = 1;
    } else {
      const cap = Number(newCapacity);
      if (!Number.isInteger(cap) || cap < 2) return alert('GROUP capacity must be ≥ 2.');
      payload.capacity = cap;
      payload.handedness = null;
    }

    try {
      const res = await fetch(`/api/admin/locations/${encodeURIComponent(locationSlug)}/bays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json())?.error || 'Create failed');
      setNewNumber(''); setNewName(''); setNewKind('GROUP'); setNewCapacity('4'); setNewDisabled(false);
      await load();
    } catch (e: any) {
      alert(e?.message || 'Create failed');
    }
  }

  function beginEdit(b: BayInfo) {
    setEditing((prev) => ({
      ...prev,
      [b.id]: {
        number: String(b.number),
        name: b.name ?? '',
        kind: b.kind,
        handedness: b.kind === 'SINGLE' ? (b.handedness ?? 'RH') : '',
        capacity: String(b.capacity),
        disabled: b.disabled,
      },
    }));
  }

  function cancelEdit(id: string) {
    setEditing((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function saveEdit(b: BayInfo) {
    const form = editing[b.id];
    if (!form) return;

    const num = Number(form.number);
    if (!Number.isInteger(num) || num <= 0) return alert('Bay number must be a positive integer.');

    const payload: any = {
      number: num,
      name: form.name || null,
      kind: form.kind,
      disabled: form.disabled,
    };

    if (form.kind === 'SINGLE') {
      if (form.handedness !== 'RH' && form.handedness !== 'LH') return alert('Handedness required for SINGLE.');
      payload.handedness = form.handedness;
      payload.capacity = 1;
    } else {
      const cap = Number(form.capacity);
      if (!Number.isInteger(cap) || cap < 2) return alert('GROUP capacity must be ≥ 2.');
      payload.capacity = cap;
      payload.handedness = null;
    }

    try {
      const res = await fetch(
        `/api/admin/locations/${encodeURIComponent(locationSlug)}/bays/${encodeURIComponent(b.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) throw new Error((await res.json())?.error || 'Update failed');
      cancelEdit(b.id);
      await load();
    } catch (e: any) {
      alert(e?.message || 'Update failed');
    }
  }

  async function deleteBay(bay: BayInfo) {
    if (!confirm(`Delete Bay ${bay.number}${bay.name ? ` (${bay.name})` : ''}?`)) return;
    try {
      const res = await fetch(
        `/api/admin/locations/${encodeURIComponent(locationSlug)}/bays/${encodeURIComponent(bay.id)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error((await res.json())?.error || 'Delete failed');
      await load();
    } catch (e: any) {
      alert(e?.message || 'Delete failed (future bookings block deletion)');
    }
  }

  const scheduleUrl = location ? buildScheduleUrl(viewOrigin, location.slug) : '';

  function showCopied(key: string) {
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Bays</h1>
          <p className="text-sm text-gray-600">Manage bays for this location</p>
        </div>
        <div className="text-sm text-gray-500">
          {location ? `${location.name} (${location.slug})` : '—'}
        </div>
      </header>

      {/* Public Schedule Link */}
      {location && (
        <section className="rounded-xl border p-5">
          <h2 className="mb-2 text-base font-semibold">Public Schedule (All Bays)</h2>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <a href={scheduleUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">
              {scheduleUrl}
            </a>
            <button
              className="rounded border px-3 py-1.5 text-xs hover:bg-gray-50"
              onClick={async () => copyToClipboard(scheduleUrl) && showCopied('schedule')}
            >
              {copiedKey === 'schedule' ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </section>
      )}

      {/* Add Bay */}
      <section className="rounded-xl border p-5">
        <h2 className="mb-3 text-base font-semibold">Add Bay</h2>
        <form onSubmit={handleAdd} className="grid grid-cols-1 gap-4 sm:grid-cols-6 sm:items-end">
          <div>
            <label className="block text-xs font-medium">Bay #</label>
            <input type="number" min={1} required className="mt-1 w-full rounded border px-2 py-2" value={newNumber} onChange={(e) => setNewNumber(onlyDigits(e.target.value))} />
          </div>
          <div>
            <label className="block text-xs font-medium">Display Name</label>
            <input type="text" className="mt-1 w-full rounded border px-2 py-2" value={newName} onChange={(e) => setNewName(onlyDigits(e.target.value))} placeholder="e.g. 4" />
          </div>
          <div>
            <label className="block text-xs font-medium">Kind</label>
            <select className="mt-1 w-full rounded border px-2 py-2" value={newKind} onChange={(e) => setNewKind(e.target.value as any)}>
              <option value="SINGLE">SINGLE</option>
              <option value="GROUP">GROUP</option>
            </select>
          </div>
          {newKind === 'SINGLE' ? (
            <div>
              <label className="block text-xs font-medium">Handedness</label>
              <select className="mt-1 w-full rounded border px-2 py-2" value={newHandedness} onChange={(e) => setNewHandedness(e.target.value as any)}>
                <option value="RH">RH</option>
                <option value="LH">LH</option>
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium">Capacity</label>
              <input type="number" min={2} className="mt-1 w-full rounded border px-2 py-2" value={newCapacity} onChange={(e) => setNewCapacity(onlyDigits(e.target.value))} />
            </div>
          )}
          <div className="flex items-center">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={newDisabled} onChange={(e) => setNewDisabled(e.target.checked)} className="h-4 w-4 rounded" />
              <span className="text-sm">Start disabled</span>
            </label>
          </div>
          <div className="sm:col-span-6">
            <button type="submit" className="rounded bg-black px-5 py-2.5 text-sm font-medium text-white hover:opacity-90">
              Add Bay
            </button>
          </div>
        </form>
      </section>

      {/* Bay List */}
      <section className="rounded-xl border p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Existing Bays</h2>
          <button onClick={load} className="rounded border px-3 py-1.5 text-xs hover:bg-gray-50">
            Refresh
          </button>
        </div>

        {state === 'loading' && <p className="text-sm text-gray-600">Loading…</p>}
        {state === 'error' && <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{errorMsg}</p>}
        {state === 'ready' && bays.length === 0 && <p className="text-sm text-gray-600">No bays yet.</p>}

        {state === 'ready' && bays.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-16" />
                <col className="w-28" />
                <col className="w-24" />
                <col className="w-20" />
                <col className="w-20" />
                <col className="w-32" />
                <col />
                <col className="w-32" />
              </colgroup>
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="p-2 text-left font-medium">Bay #</th>
                  <th className="p-2 text-left font-medium">Display</th>
                  <th className="p-2 text-left font-medium">Kind</th>
                  <th className="p-2 text-left font-medium">Hand</th>
                  <th className="p-2 text-left font-medium">Cap</th>
                  <th className="p-2 text-left font-medium">Status</th>
                  <th className="p-2 text-left font-medium">Public Link</th>
                  <th className="p-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bays.map((b) => {
                  const isEditing = !!editing[b.id];
                  const form = editing[b.id];
                  const url = buildBayViewUrl(viewOrigin, b.id, todayISO);
                  const label = `Bay ${b.number}${b.name ? ` (${b.name})` : ''}`;
                  const copyKey = `copy-${b.id}`;

                  return (
                    <React.Fragment key={b.id}>
                      <tr className={`border-b ${b.disabled ? 'bg-red-50/30' : ''}`}>
                        {/* Number */}
                        <td className="p-2 font-mono">
                          {isEditing ? (
                            <input type="number" min={1} className="w-16 rounded border px-2 py-1" value={form.number} onChange={(e) => setEditing((p) => ({ ...p, [b.id]: { ...p[b.id], number: onlyDigits(e.target.value) } }))} />
                          ) : (
                            b.number
                          )}
                        </td>
                        {/* Display Name */}
                        <td className="p-2 font-mono">
                          {isEditing ? (
                            <input type="text" className="w-24 rounded border px-2 py-1" value={form.name} onChange={(e) => setEditing((p) => ({ ...p, [b.id]: { ...p[b.id], name: onlyDigits(e.target.value) } }))} />
                          ) : (
                            b.name ?? '—'
                          )}
                        </td>
                        {/* Kind */}
                        <td className="p-2">
                          {isEditing ? (
                            <select className="w-full rounded border px-2 py-1" value={form.kind} onChange={(e) => {
                              const k = e.target.value as 'SINGLE' | 'GROUP';
                              setEditing((p) => ({
                                ...p,
                                [b.id]: {
                                  ...p[b.id],
                                  kind: k,
                                  handedness: k === 'SINGLE' ? (p[b.id].handedness || 'RH') : '',
                                  capacity: k === 'SINGLE' ? '1' : (Number(p[b.id].capacity) < 2 ? '4' : p[b.id].capacity),
                                },
                              }));
                            }}>
                              <option value="SINGLE">SINGLE</option>
                              <option value="GROUP">GROUP</option>
                            </select>
                          ) : (
                            b.kind
                          )}
                        </td>
                        {/* Handedness */}
                        <td className="p-2 text-center">
                          {b.kind === 'GROUP' ? '—' : isEditing ? (
                            form.kind === 'SINGLE' ? (
                              <select className="w-20 rounded border px-2 py-1" value={form.handedness} onChange={(e) => setEditing((p) => ({ ...p, [b.id]: { ...p[b.id], handedness: e.target.value as 'RH' | 'LH' } }))}>
                                <option value="RH">RH</option>
                                <option value="LH">LH</option>
                              </select>
                            ) : '—'
                          ) : (
                            b.handedness ?? '—'
                          )}
                        </td>
                        {/* Capacity */}
                        <td className="p-2 text-center">
                          {isEditing ? (
                            form.kind === 'SINGLE' ? '1' : (
                              <input type="number" min={2} className="w-16 rounded border px-2 py-1" value={form.capacity} onChange={(e) => setEditing((p) => ({ ...p, [b.id]: { ...p[b.id], capacity: onlyDigits(e.target.value) } }))} />
                            )
                          ) : (
                            b.capacity
                          )}
                        </td>
                        {/* Status / Disable Toggle */}
                        <td className="p-2">
                          {isEditing ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={form?.disabled ?? false}
                                onChange={(e) => setEditing((p) => ({ ...p, [b.id]: { ...p[b.id], disabled: e.target.checked } }))}
                                className="h-4 w-4 rounded"
                              />
                              <span className="text-sm">Disabled</span>
                            </label>
                          ) : (
                            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${b.disabled ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                              {b.disabled ? 'Disabled' : 'Active'}
                            </span>
                          )}
                        </td>
                        {/* Public Link */}
                        <td className="p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <a href={url} target="_blank" rel="noreferrer" className="max-w-xs truncate text-blue-600 underline">
                              {url}
                            </a>
                            <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={async () => copyToClipboard(url) && showCopied(copyKey)}>
                              {copiedKey === copyKey ? 'Copied!' : 'Copy'}
                            </button>
                            <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={() => setQrBay({ id: b.id, url, label })}>
                              QR
                            </button>
                          </div>
                        </td>
                        {/* Actions */}
                        <td className="p-2 text-right">
                          {!isEditing ? (
                            <>
                              <button className="rounded border px-3 py-1.5 text-xs hover:bg-gray-50 mr-1" onClick={() => beginEdit(b)}>
                                Edit
                              </button>
                              <button className="rounded border border-red-400 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50" onClick={() => deleteBay(b)}>
                                Delete
                              </button>
                            </>
                          ) : (
                            <>
                              <button className="rounded bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 mr-1" onClick={() => saveEdit(b)}>
                                Save
                              </button>
                              <button className="rounded border px-3 py-1.5 text-xs hover:bg-gray-50" onClick={() => cancelEdit(b.id)}>
                                Cancel
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {/* ID Row */}
                      <tr className="border-b bg-gray-50/30 text-xs">
                        <td colSpan={8} className="p-2 text-gray-600">
                          <span className="font-mono">ID: {b.id}</span>
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
            <h3 className="mb-4 text-lg font-semibold">QR Code — {qrBay.label}</h3>
            <div className="flex flex-col items-center gap-4">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrBay.url)}`}
                alt="QR"
                className="rounded border bg-white"
              />
              <div className="w-full truncate text-center text-xs text-gray-600">{qrBay.url}</div>
              <div className="flex gap-2">
                <button className="rounded border px-4 py-2 text-sm hover:bg-gray-50" onClick={async () => copyToClipboard(qrBay.url) && showCopied('qr')}>
                  {copiedKey === 'qr' ? 'Copied!' : 'Copy'}
                </button>
                <button
                  className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(qrBay.url)}`;
                    a.download = `${qrBay.label.replace(/\s+/g, '-')}.png`;
                    a.click();
                  }}
                >
                  Download
                </button>
                <button className="rounded border px-4 py-2 text-sm hover:bg-gray-50" onClick={() => setQrBay(null)}>
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