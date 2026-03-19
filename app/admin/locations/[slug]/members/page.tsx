'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

type Member = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  membershipType: string | null;
  joinDate: string | null;
  source: string;
};

type PageData = {
  members: Member[];
  total: number;
  page: number;
  totalPages: number;
};

const STATUS_TABS = ['ALL', 'ACTIVE', 'VISITOR', 'CANCELLED', 'FROZEN'] as const;

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

export default function MembersPage() {
  const rawParams = useParams() as { slug?: string } | null;
  const slug = (rawParams?.slug ?? '').toString();

  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

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

  async function handleImport(file: File) {
    if (!file || !slug) return;
    setImporting(true);
    setImportResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('locationSlug', slug);
      const res = await fetch('/api/admin/members/import', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Import failed');
      setImportResult(`Import complete: ${json.created} created, ${json.updated} updated, ${json.skipped} skipped`);
      fetchMembers(search, statusFilter, 1);
      setPage(1);
    } catch (e: any) {
      setImportResult(`Error: ${e?.message ?? 'Import failed'}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Members</h1>
          <p className="text-sm text-gray-600">
            Gymdesk members for this location
            {data ? ` · ${data.total} total` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
            }}
          />
          <button
            type="button"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-apple-border bg-white px-4 py-2 text-sm font-medium text-apple-text shadow-sm transition-colors hover:bg-apple-fill-secondary disabled:opacity-60"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            {importing ? 'Importing…' : 'Import CSV'}
          </button>
        </div>
      </header>

      {/* Import result */}
      {importResult && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${importResult.startsWith('Error') ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {importResult}
          <button type="button" onClick={() => setImportResult(null)} className="ml-3 font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Status tabs */}
        <div className="flex rounded-lg border border-apple-border bg-apple-fill-tertiary p-0.5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onStatusChange(tab)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === tab
                  ? 'bg-white text-apple-text shadow-sm'
                  : 'text-apple-secondary hover:text-apple-text'
              }`}
            >
              {tab === 'ALL' ? 'All' : tab.charAt(0) + tab.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* Search */}
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

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-apple-border bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-apple-divider bg-apple-fill-tertiary">
              <th className="px-4 py-3 font-medium text-apple-secondary">Name</th>
              <th className="px-4 py-3 font-medium text-apple-secondary">Email</th>
              <th className="px-4 py-3 font-medium text-apple-secondary">Phone</th>
              <th className="px-4 py-3 font-medium text-apple-secondary">Status</th>
              <th className="px-4 py-3 font-medium text-apple-secondary">Membership</th>
              <th className="px-4 py-3 font-medium text-apple-secondary">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-apple-divider">
            {loading && !data ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            ) : data && data.members.length > 0 ? (
              data.members.map((m) => (
                <tr key={m.id} className="transition-colors hover:bg-apple-fill-tertiary/50">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">
                    {m.firstName} {m.lastName}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{m.email}</td>
                  <td className="px-4 py-3 text-gray-600">{m.phone || '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">{m.membershipType || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(m.joinDate)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                  {search || statusFilter !== 'ALL'
                    ? 'No members match your filters'
                    : 'No members yet. Import a CSV from Gymdesk to get started.'}
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
