'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';

type Member = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string | null;
  email: string;
  phone: string;
  dob: string | null;
  gender: string | null;
  status: string;
  membershipType: string | null;
  membershipStartDate: string | null;
  signupFee: string | null;
  membershipFees: string | null;
  membershipRecurrence: string | null;
  loginLink: string | null;
  gymDeskId: string | null;
  joinDate: string | null;
  source: string;
};

type StatusCounts = Record<string, number>;

type PageData = {
  members: Member[];
  total: number;
  page: number;
  totalPages: number;
  counts: StatusCounts;
};

const STATUS_TABS = ['ACTIVE', 'VISITOR', 'CANCELLED', 'FROZEN', 'ALL'] as const;

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  VISITOR: 'bg-blue-50 text-blue-700 border-blue-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
  FROZEN: 'bg-amber-50 text-amber-700 border-amber-200',
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? 'bg-gray-50 text-gray-600 border-gray-200';
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${colors}`}>
      {status.toLowerCase()}
    </span>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-apple-xs font-medium text-apple-text-tertiary">{label}</div>
      <div className="mt-0.5 text-apple-sm text-apple-text">{value || '—'}</div>
    </div>
  );
}

export default function MembersPage() {
  const rawParams = useParams() as { slug?: string } | null;
  const slug = (rawParams?.slug ?? '').toString();

  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ACTIVE');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: boolean; total: number; created: number; updated: number; skipped: number } | null>(null);
  const [reparsing, setReparsing] = useState(false);
  const [reparseResult, setReparseResult] = useState<{ ok: boolean; total: number; updated: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchMembers = useCallback(async (s: string, status: string, p: number) => {
    if (!slug) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ locationSlug: slug, page: String(p), limit: '50' });
      if (status !== 'ALL') params.set('status', status);
      if (s.trim()) params.set('q', s.trim());
      const res = await fetch(`/api/admin/members?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'Failed to load');
      setData(await res.json());
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchMembers(search, statusFilter, page);
  }, [fetchMembers, statusFilter, page]); // eslint-disable-line react-hooks/exhaustive-deps

  function onSearchChange(val: string) {
    setSearch(val);
    setPage(1);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchMembers(val, statusFilter, 1), 300);
  }

  function onStatusChange(s: string) {
    setStatusFilter(s);
    setPage(1);
  }

  async function handleReparse() {
    if (!slug) return;
    setReparsing(true);
    setReparseResult(null);
    try {
      const res = await fetch('/api/admin/members/reparse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationSlug: slug }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Re-parse failed');
      setReparseResult(json);
      fetchMembers(search, statusFilter, page);
    } catch (err: any) {
      setError(err?.message ?? 'Re-parse failed');
    } finally {
      setReparsing(false);
    }
  }

  async function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !slug) return;
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('locationSlug', slug);
      const res = await fetch('/api/admin/members/import', { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Import failed');
      setImportResult(json);
      fetchMembers(search, statusFilter, page);
    } catch (err: any) {
      setError(err?.message ?? 'Import failed');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const colCount = 6;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Members</h1>
          <p className="text-sm text-gray-600">
            Gymdesk members synced via webhook
            {data ? ` · ${data.total} total` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={reparsing}
            onClick={handleReparse}
            className="inline-flex items-center gap-2 rounded-lg border border-apple-border bg-white px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-apple-fill-secondary disabled:opacity-50"
          >
            {reparsing ? (
              <>
                <svg className="h-4 w-4 animate-spin text-gray-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Parsing…
              </>
            ) : (
              <>
                <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
                Re-parse Memberships
              </>
            )}
          </button>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
          <button
            type="button"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-apple-border bg-white px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-apple-fill-secondary disabled:opacity-50"
          >
            {importing ? (
              <>
                <svg className="h-4 w-4 animate-spin text-gray-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Importing…
              </>
            ) : (
              <>
                <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                Import CSV
              </>
            )}
          </button>
        </div>
      </header>

      {importResult && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${importResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          <div className="flex items-center justify-between">
            <span>
              Import complete — <strong>{importResult.created}</strong> created, <strong>{importResult.updated}</strong> updated, <strong>{importResult.skipped}</strong> skipped ({importResult.total} rows)
            </span>
            <button type="button" onClick={() => setImportResult(null)} className="ml-4 text-current opacity-60 hover:opacity-100">✕</button>
          </div>
        </div>
      )}

      {reparseResult && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <div className="flex items-center justify-between">
            <span>
              Re-parse complete — <strong>{reparseResult.updated}</strong> of {reparseResult.total} memberships updated (dates extracted, pricing applied)
            </span>
            <button type="button" onClick={() => setReparseResult(null)} className="ml-4 text-current opacity-60 hover:opacity-100">✕</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex rounded-lg border border-apple-border bg-apple-fill-tertiary p-0.5">
          {STATUS_TABS.map((tab) => {
            const count = data?.counts?.[tab];
            const label = tab === 'ALL' ? 'All' : tab.charAt(0) + tab.slice(1).toLowerCase();
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onStatusChange(tab)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === tab
                    ? 'bg-white text-apple-text shadow-sm'
                    : 'text-apple-secondary hover:text-apple-text'
                }`}
              >
                {label}
                {count !== undefined && (
                  <span className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-[20px] text-[10px] font-semibold leading-4 ${
                    statusFilter === tab
                      ? 'bg-apple-blue/10 text-apple-blue'
                      : 'bg-gray-200/70 text-gray-500'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-md">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            placeholder="Search name, email, or phone…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-lg border border-apple-border bg-white py-2 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-apple-blue focus:outline-none focus:ring-1 focus:ring-apple-blue"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-apple-border bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-apple-divider bg-apple-fill-tertiary">
              <th className="w-8 px-2 py-3"></th>
              <th className="px-4 py-3 font-medium text-apple-secondary">Name</th>
              <th className="px-4 py-3 font-medium text-apple-secondary">Email</th>
              <th className="px-4 py-3 font-medium text-apple-secondary">Phone</th>
              <th className="px-4 py-3 font-medium text-apple-secondary">Status</th>
              <th className="px-4 py-3 font-medium text-apple-secondary">Membership</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-apple-divider">
            {loading && !data ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-12 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            ) : data && data.members.length > 0 ? (
              data.members.map((m) => {
                const isExpanded = expandedId === m.id;
                return (
                  <tr key={m.id} className="group">
                    <td colSpan={colCount} className="p-0">
                      {/* Main row */}
                      <button
                        type="button"
                        className="flex w-full items-center text-left transition-colors hover:bg-apple-fill-tertiary/50"
                        onClick={() => setExpandedId(isExpanded ? null : m.id)}
                      >
                        <span className="w-8 flex-shrink-0 px-2 py-3 text-center">
                          <svg className={`inline h-3.5 w-3.5 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </span>
                        <span className="whitespace-nowrap px-4 py-3 font-medium flex-1 min-w-[140px]">
                          {m.firstName} {m.lastName}
                        </span>
                        <span className="px-4 py-3 text-gray-600 flex-1 min-w-[180px]">{m.email}</span>
                        <span className="px-4 py-3 text-gray-600 flex-1 min-w-[120px]">{m.phone || '—'}</span>
                        <span className="px-4 py-3 flex-1 min-w-[100px]">
                          <StatusBadge status={m.status} />
                        </span>
                        <span className="px-4 py-3 text-gray-600 flex-1 min-w-[140px]">{m.membershipType || '—'}</span>
                      </button>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="border-t border-apple-divider/50 bg-apple-fill-tertiary/30 px-10 py-4">
                          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                            <DetailField label="Full Name" value={m.fullName || `${m.firstName} ${m.lastName}`} />
                            <DetailField label="Email" value={m.email} />
                            <DetailField label="Phone" value={m.phone} />
                            <DetailField label="Date of Birth" value={formatDate(m.dob)} />
                            <DetailField label="Gender" value={m.gender} />
                            <DetailField label="Status" value={m.status} />
                            <DetailField label="Membership Type" value={m.membershipType} />
                            <DetailField label="Joined" value={formatDate(m.joinDate)} />
                            <DetailField label="Membership Start" value={formatDate(m.membershipStartDate)} />
                            <DetailField label="Signup Fee" value={m.signupFee} />
                            <DetailField label="Membership Fees" value={m.membershipFees} />
                            <DetailField label="Recurrence" value={m.membershipRecurrence} />
                            <DetailField label="Gymdesk ID" value={m.gymDeskId} />
                            {m.loginLink && (
                              <div>
                                <div className="text-apple-xs font-medium text-apple-text-tertiary">Gymdesk Portal</div>
                                <a href={m.loginLink} target="_blank" rel="noopener noreferrer" className="mt-0.5 text-apple-sm text-apple-blue hover:underline">
                                  Open Portal
                                </a>
                              </div>
                            )}
                          </div>
                          {m.phone && (
                            <div className="mt-4 pt-4 border-t border-apple-divider/50">
                              <a
                                href={`sms:${m.phone.replace(/[^+\d]/g, '')}`}
                                className="inline-flex items-center gap-2 rounded-lg border border-apple-border bg-white px-4 py-2.5 text-sm font-medium text-apple-text shadow-sm transition-colors hover:bg-apple-fill-secondary"
                              >
                                <svg className="h-4 w-4 text-apple-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                                </svg>
                                Message on Quo
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={colCount} className="px-4 py-12 text-center text-gray-400">
                  {search || statusFilter !== 'ALL'
                    ? 'No members match your filters'
                    : 'No members yet. Connect Gymdesk webhooks to sync members automatically.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Page {data.page} of {data.totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-apple-border px-3 py-1.5 text-xs font-medium hover:bg-apple-fill-secondary disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-apple-border px-3 py-1.5 text-xs font-medium hover:bg-apple-fill-secondary disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
