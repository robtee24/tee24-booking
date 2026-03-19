// app/admin/layout.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PropsWithChildren, useCallback, useEffect, useMemo, useState } from 'react';

type SidebarLocation = { name: string; slug: string };

export default function AdminLayout({ children }: PropsWithChildren) {
  const pathname = usePathname();

  const activeSlug = useMemo(() => {
    const m = pathname?.match(/\/admin\/locations\/([^/]+)/);
    return m?.[1] ?? null;
  }, [pathname]);

  const [locOpen, setLocOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [locations, setLocations] = useState<SidebarLocation[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/location-settings', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        setLocations(
          (json?.locations ?? []).map((r: any) => ({ name: r.name, slug: r.slug }))
        );
      } catch {}
    })();
  }, [pathname]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  const crumbs = useMemo(() => buildBreadcrumbs(pathname), [pathname]);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <div className="flex min-h-screen bg-apple-bg">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-apple-divider bg-white/95 backdrop-blur-xl transition-transform duration-300 ease-in-out',
          'lg:static lg:z-auto lg:w-[240px] lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* Sidebar header */}
        <div className="flex h-14 items-center justify-between border-b border-apple-divider px-5">
          <Link href="/admin" className="text-apple-lg font-semibold tracking-tight text-apple-text">
            Tee24
          </Link>
          <button
            onClick={closeSidebar}
            className="rounded-apple-sm p-1.5 text-apple-text-tertiary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text lg:hidden"
            aria-label="Close menu"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3">
          {/* Manage */}
          <div className="mb-1 px-3 pt-2 pb-1.5 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">
            Manage
          </div>
          <ul className="space-y-0.5">
            <li>
              <NavLink href="/admin" currentPath={pathname} exact icon="dashboard">
                Dashboard
              </NavLink>
            </li>
            <li>
              <button
                type="button"
                className={[
                  'flex w-full items-center gap-2.5 rounded-apple-sm px-3 py-2.5 text-apple-sm font-medium transition-colors duration-150',
                  pathname?.startsWith('/admin/locations')
                    ? 'bg-apple-blue text-white'
                    : 'text-apple-text-secondary hover:bg-apple-fill-secondary hover:text-apple-text',
                ].join(' ')}
                onClick={() => setLocOpen((v) => !v)}
                aria-expanded={locOpen}
              >
                <span className={pathname?.startsWith('/admin/locations') ? 'text-white' : 'text-apple-text-tertiary'}>
                  {NAV_ICONS.location}
                </span>
                <span className="flex-1 text-left">Locations</span>
                <svg
                  className={`h-4 w-4 transition-transform duration-200 ${locOpen ? 'rotate-0' : '-rotate-90'} ${pathname?.startsWith('/admin/locations') ? 'text-white/70' : 'text-apple-text-tertiary'}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {locOpen && (
                <ul className="mt-1 ml-4 space-y-0.5 border-l-2 border-apple-divider pl-3">
                  <li>
                    <SubNavLink href="/admin/locations" currentPath={pathname} exact>
                      All Locations
                    </SubNavLink>
                  </li>
                  {locations.map((loc) => (
                    <li key={loc.slug}>
                      <SubNavLink href={`/admin/locations/${loc.slug}`} currentPath={pathname}>
                        {loc.name}
                      </SubNavLink>
                      {activeSlug === loc.slug && (
                        <ul className="mt-0.5 ml-3 space-y-0.5 border-l border-apple-divider/60 pl-3">
                          <li>
                            <SubNavLink href={`/admin/locations/${loc.slug}`} currentPath={pathname} exact>
                              Details
                            </SubNavLink>
                          </li>
                          <li>
                            <SubNavLink href={`/admin/locations/${loc.slug}/bays`} currentPath={pathname}>
                              Bays
                            </SubNavLink>
                          </li>
                          <li>
                            <SubNavLink href={`/admin/locations/${loc.slug}/notifications`} currentPath={pathname}>
                              Notifications
                            </SubNavLink>
                          </li>
                          <li>
                            <SubNavLink href={`/admin/locations/${loc.slug}/bookings`} currentPath={pathname}>
                              Bookings
                            </SubNavLink>
                          </li>
                          <li>
                            <SubNavLink href={`/admin/locations/${loc.slug}/members`} currentPath={pathname}>
                              Members
                            </SubNavLink>
                          </li>
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          </ul>

          {/* Settings */}
          <div className="mb-1 mt-6 px-3 pt-2 pb-1.5 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary">
            Settings
          </div>
          <ul className="space-y-0.5">
            <li>
              <NavLink href="/admin/admins" currentPath={pathname} icon="admins">
                Admins
              </NavLink>
            </li>
            <li>
              <NavLink href="/admin/bay-app" currentPath={pathname} icon="bayapp">
                Bay App
              </NavLink>
            </li>
          </ul>
        </nav>

        {/* Sidebar footer */}
        <div className="border-t border-apple-divider p-3">
          <a
            href="/admin/logout"
            className="flex items-center gap-2.5 rounded-apple-sm px-3 py-2.5 text-apple-sm font-medium text-apple-text-secondary transition-colors duration-150 hover:bg-apple-red/5 hover:text-apple-red"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            Sign Out
          </a>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-apple-divider bg-white/80 backdrop-blur-xl">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            {/* Hamburger */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-apple-sm p-2 text-apple-text-secondary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text lg:hidden"
              aria-label="Open menu"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>

            <Breadcrumbs items={crumbs} />
          </div>
        </header>

        {/* Content */}
        <main className="mx-auto w-full max-w-5xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

/* ---------------- Nav components ---------------- */

const NAV_ICONS: Record<string, React.ReactNode> = {
  dashboard: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
  location: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
    </svg>
  ),
  admins: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),
  bayapp: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" />
    </svg>
  ),
};

function NavLink({
  href,
  currentPath,
  children,
  icon,
  exact = false,
}: PropsWithChildren<{ href: string; currentPath: string | null; icon?: string; exact?: boolean }>) {
  const active = exact
    ? currentPath === href
    : currentPath === href || (!!currentPath && currentPath.startsWith(href + '/'));

  return (
    <Link
      href={href}
      className={[
        'flex items-center gap-2.5 rounded-apple-sm px-3 py-2.5 text-apple-sm font-medium transition-colors duration-150',
        active
          ? 'bg-apple-blue text-white'
          : 'text-apple-text-secondary hover:bg-apple-fill-secondary hover:text-apple-text',
      ].join(' ')}
    >
      {icon && NAV_ICONS[icon] && (
        <span className={active ? 'text-white' : 'text-apple-text-tertiary'}>
          {NAV_ICONS[icon]}
        </span>
      )}
      {children}
    </Link>
  );
}

function SubNavLink({
  href,
  currentPath,
  children,
  exact = false,
}: PropsWithChildren<{ href: string; currentPath: string | null; exact?: boolean }>) {
  const active = exact
    ? currentPath === href
    : currentPath === href || (!!currentPath && currentPath.startsWith(href + '/'));

  return (
    <Link
      href={href}
      className={[
        'block rounded-apple-sm px-3 py-2 text-apple-sm transition-colors duration-150',
        active
          ? 'font-semibold text-apple-blue bg-apple-blue/5'
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
    <nav aria-label="Breadcrumb" className="min-w-0 truncate">
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
    else if (seg === 'members') label = 'Members';
    else if (seg === 'bay-app') label = 'Bay App';
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
