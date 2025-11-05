// app/admin/layout.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PropsWithChildren, useEffect, useMemo, useState } from 'react';

export default function AdminLayout({ children }: PropsWithChildren) {
  const pathname = usePathname();

  // Detect if we're inside a specific location: /admin/locations/[slug](/...)
  const { slug, basePath } = useMemo(() => {
    const m = pathname?.match(/\/admin\/locations\/([^/]+)/);
    return {
      slug: m?.[1] ?? null,
      basePath: '/admin',
    };
  }, [pathname]);

  // Auto-expand location section if we're in a location page
  const [locOpen, setLocOpen] = useState<boolean>(Boolean(slug));
  useEffect(() => setLocOpen(Boolean(slug)), [slug]);

  const crumbs = useMemo(() => buildBreadcrumbs(pathname), [pathname]);

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="fixed z-40 w-64 shrink-0 border-r bg-white lg:static">
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Link href="/admin" className="font-semibold tracking-tight">
            Admin
          </Link>
        </div>

        <nav className="space-y-6 p-4 text-sm">
          {/* Primary navigation */}
          <div>
            <div className="mb-1 px-2 text-xs font-semibold uppercase text-gray-500">
              Manage
            </div>
            <ul className="space-y-1">
              <li>
                <NavLink href="/admin/locations" currentPath={pathname}>
                  Locations
                </NavLink>
              </li>
              <li>
                <NavLink href="/admin/admins" currentPath={pathname}>
                  Admins
                </NavLink>
              </li>
            </ul>
          </div>

          {/* Location-specific subtree (only when a location is selected) */}
          {slug && (
            <div>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded px-2 py-1.5 hover:bg-gray-50"
                onClick={() => setLocOpen((v) => !v)}
                aria-expanded={locOpen}
                aria-controls="location-subtree"
                title="Toggle location menu"
              >
                <span className="text-xs font-semibold uppercase text-gray-500">
                  {`Location: ${titleize(slug)}`}
                </span>
                <span className="text-gray-400">{locOpen ? '▾' : '▸'}</span>
              </button>

              {locOpen && (
                <ul id="location-subtree" className="mt-1 space-y-1 pl-2">
                  <li>
                    <NavLink
                      href={`/admin/locations/${slug}`}
                      currentPath={pathname}
                    >
                      Details
                    </NavLink>
                  </li>
                  <li>
                    <NavLink
                      href={`/admin/locations/${slug}/bays`}
                      currentPath={pathname}
                    >
                      Bays
                    </NavLink>
                  </li>
                  <li>
                    <NavLink
                      href={`/admin/locations/${slug}/notifications`}
                      currentPath={pathname}
                    >
                      Notifications
                    </NavLink>
                  </li>
                  <li>
                    <NavLink
                      href={`/admin/locations/${slug}/bookings`}
                      currentPath={pathname}
                    >
                      Bookings
                    </NavLink>
                  </li>
                </ul>
              )}
            </div>
          )}
        </nav>
      </aside>

      {/* Main column */}
      <div className="flex min-h-screen flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur">
          <div className="flex h-14 items-center justify-between px-4">
            <Breadcrumbs items={crumbs} />
            <a
              href="/admin/logout"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-100 transition"
            >
              Log out
            </a>
          </div>
        </header>

        {/* Content */}
        <main className="mx-auto w-full max-w-6xl flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}

/* ---------------- UI helpers ---------------- */

function NavLink({
  href,
  currentPath,
  children,
}: PropsWithChildren<{ href: string; currentPath: string | null }>) {
  const active =
    currentPath === href ||
    (!!currentPath && currentPath.startsWith(href + '/'));

  return (
    <Link
      href={href}
      className={[
        'block rounded px-2 py-1.5',
        active ? 'bg-gray-900 text-white' : 'hover:bg-gray-100',
      ].join(' ')}
    >
      {children}
    </Link>
  );
}

/* ---------------- Breadcrumb Components ---------------- */

type Crumb = { label: string; href?: string };

function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (!items?.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="truncate">
      <ol className="flex items-center gap-2 text-sm">
        {items.map((c, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-2">
              {i > 0 && <span className="text-gray-400">›</span>}
              {isLast || !c.href ? (
                <span className="max-w-[28ch] truncate font-medium">
                  {c.label}
                </span>
              ) : (
                <Link
                  href={c.href}
                  className="max-w-[28ch] truncate text-gray-600 hover:underline"
                >
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---------------- Breadcrumb logic (adds Bays, removes Settings) ---------------- */

function buildBreadcrumbs(pathname: string | null): Crumb[] {
  if (!pathname) return [{ label: 'Admin', href: '/admin' }];

  const parts = pathname.split('/').filter(Boolean); // ['admin','locations','clarksville','bays']
  const crumbs: Crumb[] = [];

  // Always start with Admin root
  crumbs.push({ label: 'Admin', href: '/admin' });

  // Build each step, preserving /admin/... prefix
  let acc = '/admin';
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    acc += '/' + seg;

    let label = seg;
    if (seg === 'locations') label = 'Locations';
    else if (seg === 'notifications') label = 'Notifications';
    else if (seg === 'bookings') label = 'Bookings';
    else if (seg === 'admins') label = 'Admins';
    else if (seg === 'bays') label = 'Bays';
    else label = titleize(seg);

    const isLast = i === parts.length - 1;
    crumbs.push({ label, href: isLast ? undefined : acc });
  }

  return crumbs;
}

function titleize(s: string) {
  try {
    return s
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());
  } catch {
    return s;
  }
}
