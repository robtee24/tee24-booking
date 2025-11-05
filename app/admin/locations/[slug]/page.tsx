// app/admin/locations/[slug]/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

/* ---------- Types ---------- */
type DayHours = { day: number; closed?: boolean; open?: string; close?: string };

type LocationSettings = {
  id: string;
  name: string;
  slug: string;

  bookingNote?: string | null;
  passAccessUrl?: string | null; // <-- NEW

  open24Hours?: boolean | null;
  hours?: DayHours[] | null;

  minBookingMinutes?: number | null;
  maxBookingMinutes?: number | null;
  maxActiveBookingsPerGuest?: number | null;
  activeBookingIdentifyBy?: 'phone' | 'email' | 'either' | null;
  activeBookingWindowHours?: number | null;
  maxConsecutiveBookingsPerGuest?: number | null;

  updatedAt?: string | null;
};

/* ---------- Page ---------- */
export default function LocationDetailsPage() {
  const rawParams = useParams() as { slug?: string } | null;
  const slug = (rawParams?.slug ?? '').toString();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<LocationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Success banner (used after slug-change redirect)
  const [banner, setBanner] = useState<string | null>(null);

  // Keep the originally loaded slug for comparison
  const originalSlugRef = useRef<string | null>(null);

  // Overview (editable name/slug)
  const [editOverview, setEditOverview] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [slugDraft, setSlugDraft] = useState('');

  // Booking note
  const [editNote, setEditNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string>('');

  // Pass Access URL
  const [editPassUrl, setEditPassUrl] = useState(false);              // <-- NEW
  const [passUrlDraft, setPassUrlDraft] = useState<string>('');       // <-- NEW

  // Hours
  const [editHours, setEditHours] = useState(false);
  const [open24Draft, setOpen24Draft] = useState<boolean>(false);
  const [hoursDraft, setHoursDraft] = useState<DayHours[]>(defaultWeekHours());

  // Rules
  const [editRules, setEditRules] = useState(false);
  const [rulesDraft, setRulesDraft] = useState({
    minBookingMinutes: 60,
    maxBookingMinutes: 120,
    maxActiveBookingsPerGuest: 2,
    activeBookingIdentifyBy: 'either' as 'phone' | 'email' | 'either',
    activeBookingWindowHours: 24,
    maxConsecutiveBookingsPerGuest: 2,
  });

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Load current settings
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true); setErr(null); setSaveMsg(null);
        const res = await fetch(
          `/api/admin/location-settings?locationSlug=${encodeURIComponent(String(slug))}`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw await errorFromResponse(res, 'Failed to load');
        const json = await res.json();
        const settings: LocationSettings = json?.settings ?? json;
        if (cancelled) return;

        setData(settings);
        originalSlugRef.current = settings.slug;

        // seed overview drafts
        setNameDraft(settings.name ?? '');
        setSlugDraft(settings.slug ?? '');

        // seed booking note
        setNoteDraft(settings.bookingNote ?? '');

        // seed pass access url
        setPassUrlDraft(settings.passAccessUrl ?? ''); // <-- NEW

        // seed hours
        const hours = normalizeWeekHours(settings.hours);
        setHoursDraft(hours);
        setOpen24Draft(Boolean(settings.open24Hours));

        // seed rules
        setRulesDraft({
          minBookingMinutes: toOpt(settings.minBookingMinutes, 30, 720, 60),
          maxBookingMinutes: toOpt(settings.maxBookingMinutes, 30, 720, 120),
          maxActiveBookingsPerGuest: toOpt(settings.maxActiveBookingsPerGuest, 0, 20, 2),
          activeBookingIdentifyBy: (settings.activeBookingIdentifyBy ?? 'either') as any,
          activeBookingWindowHours: toOpt(settings.activeBookingWindowHours, 1, 720, 24),
          maxConsecutiveBookingsPerGuest: toOpt(settings.maxConsecutiveBookingsPerGuest, 1, 10, 2),
        });
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (slug) load();
    return () => { cancelled = true; };
  }, [slug]);

  // One-time banner after ?updated=1 redirect; then clean the URL
  useEffect(() => {
    if (searchParams?.get('updated') === '1') {
      setBanner('Location updated successfully.');
      router.replace(`/admin/locations/${slug}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, slug]);

  const hoursOptions = useMemo(() => buildTimeOptions(), []);
  const durationOptions = useMemo(() => buildDurationOptions(), []);
  const idByOptions: Array<{ v: 'either' | 'email' | 'phone'; label: string }> = [
    { v: 'either', label: 'Either email or phone' },
    { v: 'email', label: 'Email' },
    { v: 'phone', label: 'Phone' },
  ];

  /* ---------- Saves ---------- */

  // Save name and slug; if slug changed, redirect to new URL with banner
  async function saveOverview() {
    if (!data) return;
    try {
      setSaving(true); setSaveMsg(null);
      const payload = {
        locationSlug: originalSlugRef.current ?? data.slug,
        name: nameDraft.trim(),
        slug: slugDraft.trim(),
      };
      const res = await fetch('/api/admin/location-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await errorFromResponse(res, 'Save failed');

      const json = await res.json();
      const updated: LocationSettings = json?.settings ?? json;

      const oldSlug = originalSlugRef.current ?? data.slug;
      const newSlug = updated.slug;

      // Update local
      setData({
        ...data,
        name: updated.name,
        slug: updated.slug,
        updatedAt: new Date().toISOString(),
      });

      setEditOverview(false);
      setSaveMsg('Overview saved.');

      if (newSlug && newSlug !== oldSlug) {
        originalSlugRef.current = newSlug;
        router.replace(`/admin/locations/${encodeURIComponent(newSlug)}?updated=1`);
      }
    } catch (e: any) {
      setSaveMsg(e?.message ?? 'Failed to save overview');
    } finally {
      setSaving(false);
    }
  }

  async function saveBookingNote() {
    if (!data) return;
    try {
      setSaving(true); setSaveMsg(null);
      const payload = {
        locationSlug: data.slug,
        bookingNote: noteDraft,
      };
      const res = await fetch('/api/admin/location-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await errorFromResponse(res, 'Save failed');
      setData({ ...data, bookingNote: noteDraft, updatedAt: new Date().toISOString() });
      setEditNote(false);
      setSaveMsg('Booking note saved.');
    } catch (e: any) {
      setSaveMsg(e?.message ?? 'Failed to save booking note');
    } finally {
      setSaving(false);
    }
  }

  // NEW: save Pass Access URL
  async function savePassUrl() {
    if (!data) return;
    try {
      setSaving(true); setSaveMsg(null);
      const payload = {
        locationSlug: data.slug,
        passAccessUrl: passUrlDraft.trim() || null, // empty -> null
      };
      const res = await fetch('/api/admin/location-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await errorFromResponse(res, 'Save failed');
      setData({ ...data, passAccessUrl: payload.passAccessUrl, updatedAt: new Date().toISOString() });
      setEditPassUrl(false);
      setSaveMsg('Pass Access URL saved.');
    } catch (e: any) {
      setSaveMsg(e?.message ?? 'Failed to save Pass Access URL');
    } finally {
      setSaving(false);
    }
  }

  async function saveHours() {
    if (!data) return;
    const payload = {
      locationSlug: data.slug,
      open24Hours: open24Draft,
      hours: open24Draft ? [] : sanitizeHours(hoursDraft),
    };
    try {
      setSaving(true); setSaveMsg(null);
      const res = await fetch('/api/admin/location-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await errorFromResponse(res, 'Save failed');
      setData({
        ...data,
        open24Hours: payload.open24Hours,
        hours: payload.open24Hours ? [] : payload.hours,
        updatedAt: new Date().toISOString(),
      });
      setEditHours(false);
      setSaveMsg('Hours saved.');
    } catch (e: any) {
      setSaveMsg(e?.message ?? 'Failed to save hours');
    } finally {
      setSaving(false);
    }
  }

  async function saveRules() {
    if (!data) return;
    const p = rulesDraft;

    if (p.minBookingMinutes > p.maxBookingMinutes) {
      setSaveMsg('Min booking must be less than or equal to Max booking.');
      return;
    }

    const payload = {
      locationSlug: data.slug,
      minBookingMinutes: Number(p.minBookingMinutes),
      maxBookingMinutes: Number(p.maxBookingMinutes),
      maxActiveBookingsPerGuest: Number(p.maxActiveBookingsPerGuest),
      activeBookingIdentifyBy: p.activeBookingIdentifyBy as 'phone' | 'email' | 'either',
      activeBookingWindowHours: Number(p.activeBookingWindowHours),
      maxConsecutiveBookingsPerGuest: Number(p.maxConsecutiveBookingsPerGuest),
    };

    try {
      setSaving(true); setSaveMsg(null);
      const res = await fetch('/api/admin/location-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await errorFromResponse(res, 'Save failed');
      setData({
        ...data,
        ...payload,
        updatedAt: new Date().toISOString(),
      } as any);
      setEditRules(false);
      setSaveMsg('Booking rules saved.');
    } catch (e: any) {
      setSaveMsg(e?.message ?? 'Failed to save booking rules');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Details</h1>
          <p className="text-sm text-gray-600">
            Overview and editable settings for <strong>{data?.name ?? String(slug)}</strong>.
          </p>
        </div>
        {data?.updatedAt && (
          <div className="text-xs text-gray-500">Updated: {new Date(data.updatedAt).toLocaleString()}</div>
        )}
      </header>

      {banner && (
        <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          {banner}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border p-6 text-sm text-gray-500">Loading…</div>
      ) : err ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">{err}</div>
      ) : !data ? (
        <div className="rounded-xl border p-6 text-sm text-gray-500">Not found.</div>
      ) : (
        <>
          {/* Overview (editable name/slug) */}
          <section className="rounded-xl border p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold">Overview</h2>
              {!editOverview ? (
                <button
                  className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
                  onClick={() => setEditOverview(true)}
                >
                  Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditOverview(false);
                      setNameDraft(data.name ?? '');
                      setSlugDraft(data.slug ?? '');
                    }}
                    className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveOverview}
                    disabled={saving}
                    className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>

            {!editOverview ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Name" value={data.name} />
                <Field label="Slug" value={data.slug} mono />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Name</label>
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    className="w-full rounded border px-2 py-2 text-sm"
                    placeholder="Location name"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Slug</label>
                  <input
                    value={slugDraft}
                    onChange={(e) => setSlugDraft(e.target.value)}
                    className="w-full rounded border px-2 py-2 font-mono text-sm"
                    placeholder="slug"
                  />
                </div>
              </div>
            )}
          </section>

          {/* Booking Note (editable) */}
          <section className="rounded-xl border p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold">Booking Note</h2>
              {!editNote ? (
                <button className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50" onClick={() => setEditNote(true)}>
                  Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => { setEditNote(false); setNoteDraft(data.bookingNote ?? ''); }}
                    className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveBookingNote}
                    disabled={saving}
                    className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>

            {!editNote ? (
              <Pre text={data.bookingNote || '—'} />
            ) : (
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={6}
                className="w-full rounded border p-2 text-sm"
                placeholder="Add a note to include in booking confirmations…"
              />
            )}
          </section>

          {/* Pass Access URL (editable) */}
          <section className="rounded-xl border p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold">Pass Access URL</h2>
              {!editPassUrl ? (
                <button className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50" onClick={() => setEditPassUrl(true)}>
                  Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => { setEditPassUrl(false); setPassUrlDraft(data.passAccessUrl ?? ''); }}
                    className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={savePassUrl}
                    disabled={saving}
                    className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>

            {!editPassUrl ? (
              <Field label="URL" value={data.passAccessUrl || '—'} mono />
            ) : (
              <div>
                <label className="mb-1 block text-xs text-gray-500">URL</label>
                <input
                  type="url"
                  value={passUrlDraft}
                  onChange={(e) => setPassUrlDraft(e.target.value)}
                  className="w-full rounded border px-2 py-2 font-mono text-sm"
                  placeholder="https://your-site.com/passes (optional)"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  If set, users will see a “Buy Passes” button on the booking confirmation page.
                </p>
              </div>
            )}
          </section>

          {/* Hours of Operation (editable) */}
          <section className="rounded-xl border p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold">Hours of Operation</h2>
              {!editHours ? (
                <button className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50" onClick={() => setEditHours(true)}>
                  Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditHours(false);
                      setOpen24Draft(Boolean(data.open24Hours));
                      setHoursDraft(normalizeWeekHours(data.hours));
                    }}
                    className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveHours}
                    disabled={saving}
                    className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>

            {!editHours ? (
              <div className="text-sm">
                <div className="mb-2">
                  <span className="font-medium">Open 24 hours:</span> {data.open24Hours ? 'Yes' : 'No'}
                </div>
                {!data.open24Hours && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {normalizeWeekHours(data.hours).map((row) => (
                      <div key={row.day} className="rounded border p-2">
                        <div className="mb-1 text-xs text-gray-500">{DAY_NAMES[row.day]}</div>
                        {row.closed ? (
                          <div className="text-gray-600">Closed</div>
                        ) : (
                          <div className="font-mono text-xs">{row.open} – {row.close}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <label className="mb-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={open24Draft}
                    onChange={(e) => setOpen24Draft(e.target.checked)}
                  />
                  Open 24 hours
                </label>

                {!open24Draft && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {hoursDraft.map((row, idx) => (
                      <div key={row.day} className="rounded border p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-xs font-medium text-gray-700">{DAY_NAMES[row.day]}</div>
                          <label className="flex items-center gap-2 text-xs text-gray-600">
                            <input
                              type="checkbox"
                              checked={Boolean(row.closed)}
                              onChange={(e) => {
                                const v = e.target.checked;
                                setHoursDraft((prev) => prev.map((r, i) => i === idx ? { ...r, closed: v } : r));
                              }}
                            />
                            Closed
                          </label>
                        </div>

                        {!row.closed && (
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <div className="mb-1 text-[11px] text-gray-500">Open</div>
                              <select
                                value={row.open ?? '09:00'}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setHoursDraft((prev) => prev.map((r, i) => i === idx ? { ...r, open: val } : r));
                                }}
                                className="w-full rounded border px-2 py-1.5 text-sm"
                              >
                                {hoursOptions.map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex-1">
                              <div className="mb-1 text-[11px] text-gray-500">Close</div>
                              <select
                                value={row.close ?? '21:00'}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setHoursDraft((prev) => prev.map((r, i) => i === idx ? { ...r, close: val } : r));
                                }}
                                className="w-full rounded border px-2 py-1.5 text-sm"
                              >
                                {hoursOptions.map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          {/* Booking Rules (editable) */}
          <section className="rounded-xl border p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold">Booking Rules</h2>
              {!editRules ? (
                <button className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50" onClick={() => setEditRules(true)}>
                  Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditRules(false);
                      if (!data) return;
                      setRulesDraft({
                        minBookingMinutes: toOpt(data.minBookingMinutes, 30, 720, 60),
                        maxBookingMinutes: toOpt(data.maxBookingMinutes, 30, 720, 120),
                        maxActiveBookingsPerGuest: toOpt(data.maxActiveBookingsPerGuest, 0, 20, 2),
                        activeBookingIdentifyBy: (data.activeBookingIdentifyBy ?? 'either') as any,
                        activeBookingWindowHours: toOpt(data.activeBookingWindowHours, 1, 720, 24),
                        maxConsecutiveBookingsPerGuest: toOpt(data.maxConsecutiveBookingsPerGuest, 1, 10, 2),
                      });
                    }}
                    className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveRules}
                    disabled={saving}
                    className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>

            {!editRules ? (
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <Field label="Min booking (min)" value={numToStr(data.minBookingMinutes, '—')} />
                <Field label="Max booking (min)" value={numToStr(data.maxBookingMinutes, '—')} />
                <Field label="Max active bookings / guest" value={numToStr(data.maxActiveBookingsPerGuest, '—')} />
                <Field label="Identify guest by" value={(data.activeBookingIdentifyBy ?? 'either').toString()} />
                <Field label="Active bookings window (hours)" value={numToStr(data.activeBookingWindowHours, '—')} />
                <Field label="Max consecutive bookings / guest" value={numToStr(data.maxConsecutiveBookingsPerGuest, '—')} />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Min booking duration</label>
                  <select
                    value={rulesDraft.minBookingMinutes}
                    onChange={(e) => setRulesDraft((p) => ({ ...p, minBookingMinutes: Number(e.target.value) }))}
                    className="w-full rounded border px-2 py-2 text-sm"
                  >
                    {durationOptions.map((m) => (
                      <option key={m} value={m}>{fmtMinutes(m)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Max booking duration</label>
                  <select
                    value={rulesDraft.maxBookingMinutes}
                    onChange={(e) => setRulesDraft((p) => ({ ...p, maxBookingMinutes: Number(e.target.value) }))}
                    className="w-full rounded border px-2 py-2 text-sm"
                  >
                    {durationOptions.map((m) => (
                      <option key={m} value={m}>{fmtMinutes(m)}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-500">Max active bookings / guest</label>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={rulesDraft.maxActiveBookingsPerGuest}
                    onChange={(e) => setRulesDraft((p) => ({ ...p, maxActiveBookingsPerGuest: Number(e.target.value) }))}
                    className="w-full rounded border px-2 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-500">Identify guest by</label>
                  <select
                    value={rulesDraft.activeBookingIdentifyBy}
                    onChange={(e) => setRulesDraft((p) => ({ ...p, activeBookingIdentifyBy: e.target.value as any }))}
                    className="w-full rounded border px-2 py-2 text-sm"
                  >
                    {idByOptions.map((o) => (
                      <option key={o.v} value={o.v}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-500">Active bookings window (hours)</label>
                  <input
                    type="number"
                    min={1}
                    max={720}
                    value={rulesDraft.activeBookingWindowHours}
                    onChange={(e) => setRulesDraft((p) => ({ ...p, activeBookingWindowHours: Number(e.target.value) }))}
                    className="w-full rounded border px-2 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-500">Max consecutive bookings / guest</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={rulesDraft.maxConsecutiveBookingsPerGuest}
                    onChange={(e) => setRulesDraft((p) => ({ ...p, maxConsecutiveBookingsPerGuest: Number(e.target.value) }))}
                    className="w-full rounded border px-2 py-2 text-sm"
                  />
                </div>
              </div>
            )}
          </section>

          {saveMsg && (
            <div className="rounded border bg-white p-3 text-xs text-gray-700">
              {saveMsg}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

async function errorFromResponse(res: Response, fallback: string) {
  try {
    const text = await res.text();
    return new Error(`${fallback} (${res.status}): ${text || res.statusText}`);
  } catch {
    return new Error(`${fallback} (${res.status})`);
  }
}

function Field({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={mono ? 'font-mono text-sm' : 'text-sm'}>{value ?? '—'}</div>
    </div>
  );
}
function Pre({ text, mono = false }: { text: string; mono?: boolean }) {
  return (
    <pre className={['whitespace-pre-wrap max-h-[420px] overflow-auto rounded border bg-gray-50 p-3 text-xs leading-5', mono ? 'font-mono' : ''].join(' ')}>
      {text}
    </pre>
  );
}

function defaultWeekHours(): DayHours[] {
  return Array.from({ length: 7 }, (_, day) => ({ day, closed: false, open: '09:00', close: '21:00' }));
}
function normalizeWeekHours(input?: DayHours[] | null): DayHours[] {
  const base = defaultWeekHours();
  if (!Array.isArray(input) || input.length === 0) return base;
  const byDay = new Map<number, DayHours>();
  for (const r of input) {
    if (r && typeof r.day === 'number' && r.day >= 0 && r.day <= 6) {
      byDay.set(r.day, {
        day: r.day,
        closed: Boolean(r.closed),
        open: validTime(r.open) ? r.open! : '09:00',
        close: validTime(r.close) ? r.close! : '21:00',
      });
    }
  }
  return base.map((r) => byDay.get(r.day) ?? r);
}
function sanitizeHours(rows: DayHours[]): DayHours[] {
  return rows.map((r) => ({
    day: r.day,
    closed: Boolean(r.closed),
    open: r.closed ? undefined : (validTime(r.open) ? r.open : '09:00'),
    close: r.closed ? undefined : (validTime(r.close) ? r.close : '21:00'),
  }));
}
function validTime(s?: string) { return typeof s === 'string' && /^\d{2}:\d{2}$/.test(s); }

function buildTimeOptions(): string[] {
  // 00:00 .. 23:30 in 30-min steps
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      out.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
    }
  }
  return out;
}
function buildDurationOptions(): number[] {
  // 30 minutes to 12 hours (720) in 30-min steps
  const out: number[] = [];
  for (let m = 30; m <= 720; m += 30) out.push(m);
  return out;
}
function fmtMinutes(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h}h`;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
function numToStr(v: number | null | undefined, fallback = '-') { const n = Number(v); return Number.isFinite(n) ? String(n) : fallback; }
function toOpt(v: any, min: number, max: number, def: number) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}
