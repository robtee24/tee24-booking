// app/admin/locations/[slug]/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

type DayHours = { day: number; closed?: boolean; open?: string; close?: string };

type LocationSettings = {
  id: string;
  name: string;
  slug: string;
  bookingNote?: string | null;
  passAccessUrl?: string | null;
  open24Hours?: boolean | null;
  hours?: DayHours[] | null;
  minBookingMinutes?: number | null;
  maxBookingMinutes?: number | null;
  maxActiveBookingsPerGuest?: number | null;
  activeBookingIdentifyBy?: 'phone' | 'email' | 'either' | null;
  activeBookingWindowHours?: number | null;
  maxConsecutiveBookingsPerGuest?: number | null;
  bayAppEnabled?: boolean | null;
  bayAppUnlockMinutes?: number | null;
  bayAppWarningMinutes?: number | null;
  bayAppAutoCancelOnTimeout?: boolean | null;
  updatedAt?: string | null;
};

export default function LocationDetailsPage() {
  const rawParams = useParams() as { slug?: string } | null;
  const slug = (rawParams?.slug ?? '').toString();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<LocationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const originalSlugRef = useRef<string | null>(null);

  const [editOverview, setEditOverview] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [slugDraft, setSlugDraft] = useState('');

  const [editNote, setEditNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string>('');

  const [editPassUrl, setEditPassUrl] = useState(false);
  const [passUrlDraft, setPassUrlDraft] = useState<string>('');

  const [editHours, setEditHours] = useState(false);
  const [open24Draft, setOpen24Draft] = useState<boolean>(false);
  const [hoursDraft, setHoursDraft] = useState<DayHours[]>(defaultWeekHours());

  const [editRules, setEditRules] = useState(false);
  const [rulesDraft, setRulesDraft] = useState({
    minBookingMinutes: 60,
    maxBookingMinutes: 120,
    maxActiveBookingsPerGuest: 2,
    activeBookingIdentifyBy: 'either' as 'phone' | 'email' | 'either',
    activeBookingWindowHours: 24,
    maxConsecutiveBookingsPerGuest: 2,
  });

  const [editBayApp, setEditBayApp] = useState(false);
  const [bayAppDraft, setBayAppDraft] = useState({
    bayAppEnabled: false,
    bayAppUnlockMinutes: 10,
    bayAppWarningMinutes: 5,
    bayAppAutoCancelOnTimeout: true,
  });

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

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
        setNameDraft(settings.name ?? '');
        setSlugDraft(settings.slug ?? '');
        setNoteDraft(settings.bookingNote ?? '');
        setPassUrlDraft(settings.passAccessUrl ?? '');

        const hours = normalizeWeekHours(settings.hours);
        setHoursDraft(hours);
        setOpen24Draft(Boolean(settings.open24Hours));

        setRulesDraft({
          minBookingMinutes: toOpt(settings.minBookingMinutes, 30, 720, 60),
          maxBookingMinutes: toOpt(settings.maxBookingMinutes, 30, 720, 120),
          maxActiveBookingsPerGuest: toOpt(settings.maxActiveBookingsPerGuest, 0, 20, 2),
          activeBookingIdentifyBy: (settings.activeBookingIdentifyBy ?? 'either') as any,
          activeBookingWindowHours: toOpt(settings.activeBookingWindowHours, 1, 720, 24),
          maxConsecutiveBookingsPerGuest: toOpt(settings.maxConsecutiveBookingsPerGuest, 1, 10, 2),
        });

        setBayAppDraft({
          bayAppEnabled: Boolean(settings.bayAppEnabled),
          bayAppUnlockMinutes: toOpt(settings.bayAppUnlockMinutes, 1, 60, 10),
          bayAppWarningMinutes: toOpt(settings.bayAppWarningMinutes, 1, 60, 5),
          bayAppAutoCancelOnTimeout: settings.bayAppAutoCancelOnTimeout !== false,
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

      setData({ ...data, name: updated.name, slug: updated.slug, updatedAt: new Date().toISOString() });
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
      const res = await fetch('/api/admin/location-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationSlug: data.slug, bookingNote: noteDraft }),
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

  async function savePassUrl() {
    if (!data) return;
    try {
      setSaving(true); setSaveMsg(null);
      const payload = { locationSlug: data.slug, passAccessUrl: passUrlDraft.trim() || null };
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
      setData({ ...data, ...payload, updatedAt: new Date().toISOString() } as any);
      setEditRules(false);
      setSaveMsg('Booking rules saved.');
    } catch (e: any) {
      setSaveMsg(e?.message ?? 'Failed to save booking rules');
    } finally {
      setSaving(false);
    }
  }

  async function saveBayApp() {
    if (!data) return;
    const payload = {
      locationSlug: data.slug,
      bayAppEnabled: bayAppDraft.bayAppEnabled,
      bayAppUnlockMinutes: Number(bayAppDraft.bayAppUnlockMinutes),
      bayAppWarningMinutes: Number(bayAppDraft.bayAppWarningMinutes),
      bayAppAutoCancelOnTimeout: bayAppDraft.bayAppAutoCancelOnTimeout,
    };
    try {
      setSaving(true); setSaveMsg(null);
      const res = await fetch('/api/admin/location-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await errorFromResponse(res, 'Save failed');
      setData({ ...data, ...payload, updatedAt: new Date().toISOString() } as any);
      setEditBayApp(false);
      setSaveMsg('Bay app settings saved.');
    } catch (e: any) {
      setSaveMsg(e?.message ?? 'Failed to save bay app settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-apple-2xl font-semibold tracking-tight text-apple-text">Details</h1>
          <p className="mt-1 text-apple-base text-apple-text-secondary">
            Overview and editable settings for <strong>{data?.name ?? String(slug)}</strong>.
          </p>
        </div>
        {data?.updatedAt && (
          <div className="text-apple-xs text-apple-text-tertiary">Updated: {new Date(data.updatedAt).toLocaleString()}</div>
        )}
      </header>

      {banner && (
        <div className="rounded-apple-sm border border-apple-green/30 bg-apple-green/5 px-4 py-2.5 text-apple-sm text-apple-green">
          {banner}
        </div>
      )}

      {loading ? (
        <div className="card p-6 text-apple-sm text-apple-text-tertiary">Loading…</div>
      ) : err ? (
        <div className="rounded-apple border border-apple-red/30 bg-apple-red/5 p-4 text-apple-sm text-apple-red">{err}</div>
      ) : !data ? (
        <div className="card p-6 text-apple-sm text-apple-text-tertiary">Not found.</div>
      ) : (
        <>
          {/* Overview */}
          <SettingsSection title="Overview" editing={editOverview} onEdit={() => setEditOverview(true)} onCancel={() => { setEditOverview(false); setNameDraft(data.name ?? ''); setSlugDraft(data.slug ?? ''); }} onSave={saveOverview} saving={saving}>
            {!editOverview ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Name" value={data.name} />
                <Field label="Slug" value={data.slug} mono />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Name</label>
                  <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className="input" placeholder="Location name" />
                </div>
                <div>
                  <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Slug</label>
                  <input value={slugDraft} onChange={(e) => setSlugDraft(e.target.value)} className="input font-mono" placeholder="slug" />
                </div>
              </div>
            )}
          </SettingsSection>

          {/* Booking Note */}
          <SettingsSection title="Booking Note" editing={editNote} onEdit={() => setEditNote(true)} onCancel={() => { setEditNote(false); setNoteDraft(data.bookingNote ?? ''); }} onSave={saveBookingNote} saving={saving}>
            {!editNote ? (
              <Pre text={data.bookingNote || '—'} />
            ) : (
              <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={6} className="input resize-y" placeholder="Add a note to include in booking confirmations…" />
            )}
          </SettingsSection>

          {/* Pass Access URL */}
          <SettingsSection title="Pass Access URL" editing={editPassUrl} onEdit={() => setEditPassUrl(true)} onCancel={() => { setEditPassUrl(false); setPassUrlDraft(data.passAccessUrl ?? ''); }} onSave={savePassUrl} saving={saving}>
            {!editPassUrl ? (
              <Field label="URL" value={data.passAccessUrl || '—'} mono />
            ) : (
              <div>
                <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">URL</label>
                <input type="url" value={passUrlDraft} onChange={(e) => setPassUrlDraft(e.target.value)} className="input font-mono" placeholder="https://your-site.com/passes (optional)" />
                <p className="mt-1.5 text-apple-xs text-apple-text-tertiary">
                  If set, users will see a &quot;Buy Passes&quot; button on the booking confirmation page.
                </p>
              </div>
            )}
          </SettingsSection>

          {/* Hours */}
          <SettingsSection title="Hours of Operation" editing={editHours} onEdit={() => setEditHours(true)} onCancel={() => { setEditHours(false); setOpen24Draft(Boolean(data.open24Hours)); setHoursDraft(normalizeWeekHours(data.hours)); }} onSave={saveHours} saving={saving}>
            {!editHours ? (
              <div className="text-apple-sm">
                <div className="mb-3">
                  <span className="font-medium text-apple-text">Open 24 hours:</span>{' '}
                  <span className="text-apple-text-secondary">{data.open24Hours ? 'Yes' : 'No'}</span>
                </div>
                {!data.open24Hours && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {normalizeWeekHours(data.hours).map((row) => (
                      <div key={row.day} className="rounded-apple-sm border border-apple-border p-3">
                        <div className="mb-1 text-apple-xs font-medium text-apple-text-tertiary">{DAY_NAMES[row.day]}</div>
                        {row.closed ? (
                          <div className="text-apple-text-secondary">Closed</div>
                        ) : (
                          <div className="font-mono text-apple-xs text-apple-text">{row.open} – {row.close}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <label className="mb-4 flex items-center gap-2.5 text-apple-sm text-apple-text">
                  <input type="checkbox" checked={open24Draft} onChange={(e) => setOpen24Draft(e.target.checked)} className="h-4 w-4 rounded accent-apple-blue" />
                  Open 24 hours
                </label>

                {!open24Draft && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {hoursDraft.map((row, idx) => (
                      <div key={row.day} className="rounded-apple-sm border border-apple-border p-3">
                        <div className="mb-2.5 flex items-center justify-between">
                          <div className="text-apple-xs font-medium text-apple-text">{DAY_NAMES[row.day]}</div>
                          <label className="flex items-center gap-2 text-apple-xs text-apple-text-secondary">
                            <input type="checkbox" checked={Boolean(row.closed)} onChange={(e) => { const v = e.target.checked; setHoursDraft((prev) => prev.map((r, i) => i === idx ? { ...r, closed: v } : r)); }} className="h-3.5 w-3.5 rounded accent-apple-blue" />
                            Closed
                          </label>
                        </div>
                        {!row.closed && (
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <div className="mb-1 text-apple-xs text-apple-text-tertiary">Open</div>
                              <select value={row.open ?? '09:00'} onChange={(e) => { const val = e.target.value; setHoursDraft((prev) => prev.map((r, i) => i === idx ? { ...r, open: val } : r)); }} className="input text-apple-xs">
                                {hoursOptions.map((t) => (<option key={t} value={t}>{t}</option>))}
                              </select>
                            </div>
                            <div className="flex-1">
                              <div className="mb-1 text-apple-xs text-apple-text-tertiary">Close</div>
                              <select value={row.close ?? '21:00'} onChange={(e) => { const val = e.target.value; setHoursDraft((prev) => prev.map((r, i) => i === idx ? { ...r, close: val } : r)); }} className="input text-apple-xs">
                                {hoursOptions.map((t) => (<option key={t} value={t}>{t}</option>))}
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
          </SettingsSection>

          {/* Booking Rules */}
          <SettingsSection title="Booking Rules" editing={editRules} onEdit={() => setEditRules(true)} onCancel={() => { setEditRules(false); if (!data) return; setRulesDraft({ minBookingMinutes: toOpt(data.minBookingMinutes, 30, 720, 60), maxBookingMinutes: toOpt(data.maxBookingMinutes, 30, 720, 120), maxActiveBookingsPerGuest: toOpt(data.maxActiveBookingsPerGuest, 0, 20, 2), activeBookingIdentifyBy: (data.activeBookingIdentifyBy ?? 'either') as any, activeBookingWindowHours: toOpt(data.activeBookingWindowHours, 1, 720, 24), maxConsecutiveBookingsPerGuest: toOpt(data.maxConsecutiveBookingsPerGuest, 1, 10, 2) }); }} onSave={saveRules} saving={saving}>
            {!editRules ? (
              <div className="grid grid-cols-1 gap-4 text-apple-sm sm:grid-cols-2">
                <Field label="Min booking (min)" value={numToStr(data.minBookingMinutes, '—')} />
                <Field label="Max booking (min)" value={numToStr(data.maxBookingMinutes, '—')} />
                <Field label="Max active bookings / guest" value={numToStr(data.maxActiveBookingsPerGuest, '—')} />
                <Field label="Identify guest by" value={(data.activeBookingIdentifyBy ?? 'either').toString()} />
                <Field label="Active bookings window (hours)" value={numToStr(data.activeBookingWindowHours, '—')} />
                <Field label="Max consecutive bookings / guest" value={numToStr(data.maxConsecutiveBookingsPerGuest, '—')} />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 text-apple-sm sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Min booking duration</label>
                  <select value={rulesDraft.minBookingMinutes} onChange={(e) => setRulesDraft((p) => ({ ...p, minBookingMinutes: Number(e.target.value) }))} className="input">
                    {durationOptions.map((m) => (<option key={m} value={m}>{fmtMinutes(m)}</option>))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Max booking duration</label>
                  <select value={rulesDraft.maxBookingMinutes} onChange={(e) => setRulesDraft((p) => ({ ...p, maxBookingMinutes: Number(e.target.value) }))} className="input">
                    {durationOptions.map((m) => (<option key={m} value={m}>{fmtMinutes(m)}</option>))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Max active bookings / guest</label>
                  <input type="number" min={0} max={20} value={rulesDraft.maxActiveBookingsPerGuest} onChange={(e) => setRulesDraft((p) => ({ ...p, maxActiveBookingsPerGuest: Number(e.target.value) }))} className="input" />
                </div>
                <div>
                  <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Identify guest by</label>
                  <select value={rulesDraft.activeBookingIdentifyBy} onChange={(e) => setRulesDraft((p) => ({ ...p, activeBookingIdentifyBy: e.target.value as any }))} className="input">
                    {idByOptions.map((o) => (<option key={o.v} value={o.v}>{o.label}</option>))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Active bookings window (hours)</label>
                  <input type="number" min={1} max={720} value={rulesDraft.activeBookingWindowHours} onChange={(e) => setRulesDraft((p) => ({ ...p, activeBookingWindowHours: Number(e.target.value) }))} className="input" />
                </div>
                <div>
                  <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Max consecutive bookings / guest</label>
                  <input type="number" min={1} max={10} value={rulesDraft.maxConsecutiveBookingsPerGuest} onChange={(e) => setRulesDraft((p) => ({ ...p, maxConsecutiveBookingsPerGuest: Number(e.target.value) }))} className="input" />
                </div>
              </div>
            )}
          </SettingsSection>

          {/* Bay App Settings */}
          <SettingsSection title="Bay App Settings" editing={editBayApp} onEdit={() => setEditBayApp(true)} onCancel={() => { setEditBayApp(false); setBayAppDraft({ bayAppEnabled: Boolean(data.bayAppEnabled), bayAppUnlockMinutes: toOpt(data.bayAppUnlockMinutes, 1, 60, 10), bayAppWarningMinutes: toOpt(data.bayAppWarningMinutes, 1, 60, 5), bayAppAutoCancelOnTimeout: data.bayAppAutoCancelOnTimeout !== false }); }} onSave={saveBayApp} saving={saving}>
            {!editBayApp ? (
              <div className="grid grid-cols-1 gap-4 text-apple-sm sm:grid-cols-2">
                <Field label="Bay App Enabled" value={data.bayAppEnabled ? 'Yes' : 'No'} />
                <Field label="Unlock Timer (minutes)" value={numToStr(data.bayAppUnlockMinutes, '10')} />
                <Field label="Warning Before Reservation (minutes)" value={numToStr(data.bayAppWarningMinutes, '5')} />
                <Field label="Auto-Cancel on Timeout" value={data.bayAppAutoCancelOnTimeout !== false ? 'Yes' : 'No'} />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 text-apple-sm sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="flex items-center gap-2.5 text-apple-sm text-apple-text">
                    <input type="checkbox" checked={bayAppDraft.bayAppEnabled} onChange={(e) => setBayAppDraft((p) => ({ ...p, bayAppEnabled: e.target.checked }))} className="h-4 w-4 rounded accent-apple-blue" />
                    Enable Bay Check-In App
                  </label>
                  <p className="mt-1.5 ml-6.5 text-apple-xs text-apple-text-tertiary">
                    When enabled, desktop apps on bay computers will lock bays at reservation time and require phone verification to unlock.
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Unlock Timer (minutes)</label>
                  <input type="number" min={1} max={60} value={bayAppDraft.bayAppUnlockMinutes} onChange={(e) => setBayAppDraft((p) => ({ ...p, bayAppUnlockMinutes: Number(e.target.value) }))} className="input" />
                  <p className="mt-1 text-apple-xs text-apple-text-tertiary">How long before the bay auto-unlocks and the reservation is cancelled.</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-apple-xs font-medium text-apple-text-secondary">Warning Before Reservation (minutes)</label>
                  <input type="number" min={1} max={60} value={bayAppDraft.bayAppWarningMinutes} onChange={(e) => setBayAppDraft((p) => ({ ...p, bayAppWarningMinutes: Number(e.target.value) }))} className="input" />
                  <p className="mt-1 text-apple-xs text-apple-text-tertiary">How many minutes before a reservation to show the warning bar.</p>
                </div>
                <div className="sm:col-span-2">
                  <label className="flex items-center gap-2.5 text-apple-sm text-apple-text">
                    <input type="checkbox" checked={bayAppDraft.bayAppAutoCancelOnTimeout} onChange={(e) => setBayAppDraft((p) => ({ ...p, bayAppAutoCancelOnTimeout: e.target.checked }))} className="h-4 w-4 rounded accent-apple-blue" />
                    Auto-cancel reservation on timeout
                  </label>
                  <p className="mt-1.5 ml-6.5 text-apple-xs text-apple-text-tertiary">
                    If the guest doesn&apos;t check in before the unlock timer expires, automatically cancel the reservation.
                  </p>
                </div>
              </div>
            )}
          </SettingsSection>

          {saveMsg && (
            <div className="rounded-apple-sm border border-apple-border bg-white p-3 text-apple-xs text-apple-text-secondary">
              {saveMsg}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Reusable section wrapper ---------- */
function SettingsSection({ title, editing, onEdit, onCancel, onSave, saving, children }: {
  title: string; editing: boolean; onEdit: () => void; onCancel: () => void; onSave: () => void; saving: boolean; children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-apple-lg font-semibold text-apple-text">{title}</h2>
        {!editing ? (
          <button className="btn-secondary !px-3 !py-1.5 text-apple-xs" onClick={onEdit}>Edit</button>
        ) : (
          <div className="flex gap-2">
            <button onClick={onCancel} className="btn-secondary !px-3 !py-1.5 text-apple-xs">Cancel</button>
            <button onClick={onSave} disabled={saving} className="btn-primary !px-3 !py-1.5 text-apple-xs">Save</button>
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

/* ---------- helpers ---------- */
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

async function errorFromResponse(res: Response, fallback: string) {
  try { const text = await res.text(); return new Error(`${fallback} (${res.status}): ${text || res.statusText}`); }
  catch { return new Error(`${fallback} (${res.status})`); }
}

function Field({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div>
      <div className="text-apple-xs font-medium text-apple-text-tertiary">{label}</div>
      <div className={`mt-0.5 text-apple-sm ${mono ? 'font-mono' : ''} text-apple-text`}>{value ?? '—'}</div>
    </div>
  );
}
function Pre({ text }: { text: string }) {
  return (
    <pre className="whitespace-pre-wrap max-h-[420px] overflow-auto rounded-apple-sm border border-apple-border bg-apple-fill-secondary p-3 text-apple-xs leading-5 text-apple-text-secondary">
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
      byDay.set(r.day, { day: r.day, closed: Boolean(r.closed), open: validTime(r.open) ? r.open! : '09:00', close: validTime(r.close) ? r.close! : '21:00' });
    }
  }
  return base.map((r) => byDay.get(r.day) ?? r);
}
function sanitizeHours(rows: DayHours[]): DayHours[] {
  return rows.map((r) => ({ day: r.day, closed: Boolean(r.closed), open: r.closed ? undefined : (validTime(r.open) ? r.open : '09:00'), close: r.closed ? undefined : (validTime(r.close) ? r.close : '21:00') }));
}
function validTime(s?: string) { return typeof s === 'string' && /^\d{2}:\d{2}$/.test(s); }

function buildTimeOptions(): string[] {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) { for (let m = 0; m < 60; m += 30) { out.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`); } }
  return out;
}
function buildDurationOptions(): number[] {
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
