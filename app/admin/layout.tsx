// app/admin/layout.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PropsWithChildren, useEffect, useMemo, useState } from 'react';

export default function AdminLayout({ children }: PropsWithChildren) {
  const pathname = usePathname();

  const { slug } = useMemo(() => {
    const m = pathname?.match(/\/admin\/locations\/([^/]+)/);
    return { slug: m?.[1] ?? null };
  }, [pathname]);

  const [locOpen, setLocOpen] = useState<boolean>(Boolean(slug));
  useEffect(() => setLocOpen(Boolean(slug)), [slug]);

  const crumbs = useMemo(() => buildBreadcrumbs(pathname), [pathname]);

  return (
    <div className="flex min-h-screen bg-apple-bg">
      {/* Sidebar */}
      <aside className="fixed z-40 flex w-[220px] shrink-0 flex-col border-r border-apple-divider bg-white/80 backdrop-blur-xl lg:static">
        <div className="flex h-14 items-center border-b border-apple-divider px-5">
          <Link href="/admin" className="text-apple-lg font-semibold tracking-tight text-apple-text">
            Tee24
          </Link>
        </div>

        <nav className="flex-1 space-y-5 p-4">
          {/* Primary navigation */}
          <div>
            <div className="mb-2 px-3 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">
              Manage
            </div>
            <ul className="space-y-0.5">
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

          {/* Location subtree */}
          {slug && (
            <div>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-apple-sm px-3 py-2 transition-colors duration-150 hover:bg-apple-fill-secondary"
                onClick={() => setLocOpen((v) => !v)}
                aria-expanded={locOpen}
                aria-controls="location-subtree"
                title="Toggle location menu"
              >
                <span className="text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">
                  {titleize(slug)}
                </span>
                <span
                  className={`text-apple-text-tertiary transition-transform duration-200 ${locOpen ? 'rotate-0' : '-rotate-90'}`}
                >
                  ▾
                </span>
              </button>

              {locOpen && (
                <ul id="location-subtree" className="mt-1 space-y-0.5 pl-2">
                  <li>
                    <NavLink href={`/admin/locations/${slug}`} currentPath={pathname}>
                      Details
                    </NavLink>
                  </li>
                  <li>
                    <NavLink href={`/admin/locations/${slug}/bays`} currentPath={pathname}>
                      Bays
                    </NavLink>
                  </li>
                  <li>
                    <NavLink href={`/admin/locations/${slug}/notifications`} currentPath={pathname}>
                      Notifications
                    </NavLink>
                  </li>
                  <li>
                    <NavLink href={`/admin/locations/${slug}/bookings`} currentPath={pathname}>
                      Bookings
                    </NavLink>
                  </li>
                </ul>
              )}
            </div>
          )}
        </nav>

        {/* Sidebar footer */}
        <div className="border-t border-apple-divider p-4">
          <a
            href="/admin/logout"
            className="block rounded-apple-sm px-3 py-2 text-apple-sm font-medium text-apple-text-secondary transition-colors duration-150 hover:bg-apple-fill-secondary hover:text-apple-text"
          >
            Sign Out
          </a>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-h-screen flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-apple-divider bg-white/80 backdrop-blur-xl">
          <div className="flex h-14 items-center justify-between px-6">
            <Breadcrumbs items={crumbs} />
          </div>
        </header>

        {/* Content */}
        <main className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</main>
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
        'block rounded-apple-sm px-3 py-2 text-apple-sm font-medium transition-colors duration-150',
        active
          ? 'bg-apple-blue text-white'
          : 'text-apple-text-secondary hover:bg-apple-fill-secondary hover:text-apple-text',
      ].join(' ')}
    >
      {children}
    </Link>
  );
}

/* ---------------- Breadcrumbs ---------------- */

type Crumb = { label: string; href?: string };

function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (!items?.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="truncate">
      <ol className="flex items-center gap-1.5 text-apple-sm">
        {items.map((c, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-apple-text-tertiary">/</span>}
              {isLast || !c.href ? (
                <span className="max-w-[28ch] truncate font-medium text-apple-text">
                  {c.label}
                </span>
              ) : (
                <Link
                  href={c.href}
                  className="max-w-[28ch] truncate text-apple-text-secondary transition-colors hover:text-apple-blue"
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

/* ---------------- Breadcrumb logic ---------------- */

function buildBreadcrumbs(pathname: string | null): Crumb[] {
  if (!pathname) return [{ label: 'Admin', href: '/admin' }];

  const parts = pathname.split('/').filter(Boolean);
  const crumbs: Crumb[] = [];

  crumbs.push({ label: 'Admin', href: '/admin' });

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
