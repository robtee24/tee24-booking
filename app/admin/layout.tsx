// app/admin/layout.tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PropsWithChildren, useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  MapPin,
  Users,
  CalendarDays,
  CreditCard,
  Megaphone,
  Settings as SettingsIcon,
  Building2,
  ChevronDown,
  Menu,
  X,
  LogOut,
  ShieldCheck,
  AppWindow,
} from 'lucide-react';

type SidebarLocation = { name: string; slug: string };

type SubItem = {
  label: string;
  href: (slug: string) => string;
  exact?: boolean;
};

type LocationSection = {
  key: string;
  label: string;
  icon: React.ReactNode;
  href: (slug: string) => string;
  subItems?: SubItem[];
};

/**
 * Per-location IA. Reflects the spec:
 *   Dashboard
 *   Scheduling   (Bays · Bookings · Notifications)
 *   Members      (List · Memberships · Documents · Attendance · Tags · Custom Fields · Member Settings)
 *   Billing      (Overview · Payments · Recurring · Discounts · Accounting · Settings)
 *   Marketing    (Dashboard · Visitors · Messaging · Templates · Automations · Referrals · Settings)
 *   Location Settings  (Details · Hours · Booking Rules · Bay App · Pass Access · Kisi Doors · Comms · Tax)
 */
const LOCATION_SECTIONS: LocationSection[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: <LayoutDashboard className="h-4 w-4" />,
    href: (slug) => `/admin/locations/${slug}/dashboard`,
  },
  {
    key: 'scheduling',
    label: 'Scheduling',
    icon: <CalendarDays className="h-4 w-4" />,
    href: (slug) => `/admin/locations/${slug}/scheduling`,
    subItems: [
      { label: 'Bookings', href: (slug) => `/admin/locations/${slug}/scheduling/bookings` },
      { label: 'Bays', href: (slug) => `/admin/locations/${slug}/scheduling/bays` },
      { label: 'Notifications', href: (slug) => `/admin/locations/${slug}/scheduling/notifications` },
    ],
  },
  {
    key: 'members',
    label: 'Members',
    icon: <Users className="h-4 w-4" />,
    href: (slug) => `/admin/locations/${slug}/members`,
    subItems: [
      { label: 'List', href: (slug) => `/admin/locations/${slug}/members/list` },
      { label: 'Memberships', href: (slug) => `/admin/locations/${slug}/members/memberships` },
      { label: 'Documents', href: (slug) => `/admin/locations/${slug}/members/documents` },
      { label: 'Attendance', href: (slug) => `/admin/locations/${slug}/members/attendance` },
      { label: 'Tags', href: (slug) => `/admin/locations/${slug}/members/tags` },
      { label: 'Custom Fields', href: (slug) => `/admin/locations/${slug}/members/custom-fields` },
      { label: 'Member Settings', href: (slug) => `/admin/locations/${slug}/members/settings` },
    ],
  },
  {
    key: 'billing',
    label: 'Billing',
    icon: <CreditCard className="h-4 w-4" />,
    href: (slug) => `/admin/locations/${slug}/billing`,
    subItems: [
      { label: 'Overview', href: (slug) => `/admin/locations/${slug}/billing` , exact: true },
      { label: 'Payments', href: (slug) => `/admin/locations/${slug}/billing/payments` },
      { label: 'Recurring', href: (slug) => `/admin/locations/${slug}/billing/recurring` },
      { label: 'Discounts', href: (slug) => `/admin/locations/${slug}/billing/discounts` },
      { label: 'Accounting', href: (slug) => `/admin/locations/${slug}/billing/accounting` },
      { label: 'Settings', href: (slug) => `/admin/locations/${slug}/billing/settings` },
    ],
  },
  {
    key: 'marketing',
    label: 'Marketing',
    icon: <Megaphone className="h-4 w-4" />,
    href: (slug) => `/admin/locations/${slug}/marketing`,
    subItems: [
      { label: 'Dashboard', href: (slug) => `/admin/locations/${slug}/marketing`, exact: true },
      { label: 'Visitors', href: (slug) => `/admin/locations/${slug}/marketing/visitors` },
      { label: 'Messaging', href: (slug) => `/admin/locations/${slug}/marketing/messaging` },
      { label: 'Templates', href: (slug) => `/admin/locations/${slug}/marketing/templates` },
      { label: 'Automations', href: (slug) => `/admin/locations/${slug}/marketing/automations` },
      { label: 'Referrals', href: (slug) => `/admin/locations/${slug}/marketing/referrals` },
      { label: 'Signup Forms', href: (slug) => `/admin/locations/${slug}/marketing/signup-forms` },
      { label: 'Settings', href: (slug) => `/admin/locations/${slug}/marketing/settings` },
    ],
  },
  {
    key: 'settings',
    label: 'Location Settings',
    icon: <SettingsIcon className="h-4 w-4" />,
    href: (slug) => `/admin/locations/${slug}`,
    subItems: [
      { label: 'Details', href: (slug) => `/admin/locations/${slug}`, exact: true },
      { label: 'Hours & Rules', href: (slug) => `/admin/locations/${slug}/settings/hours` },
      { label: 'Bay App', href: (slug) => `/admin/locations/${slug}/settings/bay-app` },
      { label: 'Kisi Doors', href: (slug) => `/admin/locations/${slug}/settings/kisi` },
      { label: 'Communications', href: (slug) => `/admin/locations/${slug}/settings/comms` },
      { label: 'Tax', href: (slug) => `/admin/locations/${slug}/settings/tax` },
      { label: 'Admins', href: (slug) => `/admin/locations/${slug}/settings/admins` },
    ],
  },
];

const OPEN_SECTIONS_STORAGE_KEY = 'tee24-admin-sidebar-open-sections';
const LOC_OPEN_STORAGE_KEY = 'tee24-admin-sidebar-loc-open';
const EXPANDED_LOC_STORAGE_KEY = 'tee24-admin-sidebar-expanded-loc';

export default function AdminLayout({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const router = useRouter();

  const activeSlug = useMemo(() => {
    const m = pathname?.match(/\/admin\/locations\/([^/]+)/);
    return m?.[1] ?? null;
  }, [pathname]);

  const [locOpen, setLocOpen] = useState(true);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [expandedLocSlug, setExpandedLocSlug] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [locations, setLocations] = useState<SidebarLocation[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(OPEN_SECTIONS_STORAGE_KEY);
      if (raw) setOpenSections(JSON.parse(raw));
      const locRaw = window.localStorage.getItem(LOC_OPEN_STORAGE_KEY);
      if (locRaw != null) setLocOpen(locRaw === '1');
      const expRaw = window.localStorage.getItem(EXPANDED_LOC_STORAGE_KEY);
      if (expRaw) setExpandedLocSlug(expRaw);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPEN_SECTIONS_STORAGE_KEY, JSON.stringify(openSections));
    } catch {}
  }, [openSections]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LOC_OPEN_STORAGE_KEY, locOpen ? '1' : '0');
    } catch {}
  }, [locOpen]);

  useEffect(() => {
    try {
      if (expandedLocSlug) {
        window.localStorage.setItem(EXPANDED_LOC_STORAGE_KEY, expandedLocSlug);
      } else {
        window.localStorage.removeItem(EXPANDED_LOC_STORAGE_KEY);
      }
    } catch {}
  }, [expandedLocSlug]);

  // When the user navigates to a different location (i.e. activeSlug changes),
  // auto-expand that location. Toggling collapse for the same location is a
  // separate user action that this effect doesn't override.
  useEffect(() => {
    if (activeSlug && expandedLocSlug !== activeSlug) {
      setExpandedLocSlug(activeSlug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlug]);

  // Auto-open the section that contains the current path. Only writes state if
  // the relevant section isn't already open — prevents needless re-renders that
  // make the menu visibly shift on navigation.
  useEffect(() => {
    if (!activeSlug || !pathname) return;
    setOpenSections((cur) => {
      let changed = false;
      const next = { ...cur };
      for (const section of LOCATION_SECTIONS) {
        const sectionRoot = section.href(activeSlug);
        const onSection =
          pathname === sectionRoot || pathname.startsWith(sectionRoot + '/');
        if (onSection && !next[section.key]) {
          next[section.key] = true;
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [pathname, activeSlug]);

  // Fetch the location list ONCE on mount. Refetching on every navigation was
  // re-rendering the whole location accordion and causing the visible bounce.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/location-settings', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (cancelled) return;
        setLocations(
          (json?.locations ?? []).map((r: any) => ({ name: r.name, slug: r.slug }))
        );
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  function toggleSection(key: string) {
    setOpenSections((cur) => ({ ...cur, [key]: !cur[key] }));
  }

  return (
    <div className="flex min-h-screen bg-apple-bg">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-apple-divider bg-white/95 backdrop-blur-xl transition-transform duration-300 ease-in-out',
          'lg:static lg:z-auto lg:w-[260px] lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex h-14 items-center justify-between border-b border-apple-divider px-5">
          <Link href="/admin" className="text-apple-lg font-semibold tracking-tight text-apple-text">
            Tee24
          </Link>
          <button
            onClick={closeSidebar}
            className="rounded-apple-sm p-1.5 text-apple-text-tertiary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav
          className="flex-1 overflow-y-auto p-3"
          style={{ overflowAnchor: 'none', scrollBehavior: 'auto' }}
        >
          {/* Top-level: Franchise standalone */}
          <ul className="space-y-0.5">
            <li>
              <NavLink href="/admin/franchise" currentPath={pathname} icon={<Building2 className="h-4 w-4" />}>
                Franchise
              </NavLink>
            </li>
          </ul>

          {/* Locations */}
          <SectionHeader className="mt-6">Locations</SectionHeader>
          <ul className="space-y-0.5">
            <li>
              <button
                type="button"
                className={[
                  'flex w-full items-center gap-2.5 rounded-apple-sm px-3 py-2.5 text-apple-sm font-medium transition-colors duration-150',
                  pathname?.startsWith('/admin/locations')
                    ? 'bg-apple-blue/5 text-apple-text'
                    : 'text-apple-text-secondary hover:bg-apple-fill-secondary hover:text-apple-text',
                ].join(' ')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setLocOpen((v) => !v)}
                aria-expanded={locOpen}
              >
                <MapPin className="h-4 w-4 text-apple-text-tertiary" />
                <span className="flex-1 text-left">All Locations</span>
                <ChevronDown
                  className={`h-4 w-4 text-apple-text-tertiary transition-transform duration-200 ${locOpen ? 'rotate-0' : '-rotate-90'}`}
                />
              </button>

              {locOpen && (
                <ul className="mt-1 ml-4 space-y-0.5 border-l-2 border-apple-divider pl-3">
                  <li>
                    <SubNavLink href="/admin/locations" currentPath={pathname} exact>
                      All Locations
                    </SubNavLink>
                  </li>
                  {locations.map((loc) => {
                    const isActive = loc.slug === activeSlug;
                    const isExpanded = expandedLocSlug === loc.slug;
                    return (
                    <li key={loc.slug}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (isActive) {
                            // Already viewing this location → toggle its sub-tree
                            setExpandedLocSlug(isExpanded ? null : loc.slug);
                          } else {
                            // Different location → navigate; auto-expand effect
                            // will handle expansion once activeSlug updates.
                            router.push(`/admin/locations/${loc.slug}/dashboard`);
                          }
                        }}
                        className={[
                          'flex w-full items-center gap-2 rounded-apple-sm px-3 py-1.5 text-apple-xs transition-colors duration-150',
                          isActive
                            ? 'font-semibold text-apple-blue bg-apple-blue/5'
                            : 'text-apple-text-secondary hover:bg-apple-fill-secondary hover:text-apple-text',
                        ].join(' ')}
                        aria-expanded={isExpanded}
                      >
                        <span className="flex-1 text-left">{loc.name}</span>
                        <ChevronDown
                          className={`h-3.5 w-3.5 text-apple-text-tertiary transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`}
                        />
                      </button>

                      {isExpanded && (
                        <ul className="mt-0.5 space-y-0.5">
                          {LOCATION_SECTIONS.map((section) => {
                            const sectionHref = section.href(loc.slug);
                            const isOpen = openSections[section.key] ?? false;
                            const sectionActive =
                              pathname === sectionHref || pathname?.startsWith(sectionHref + '/');

                            return (
                              <li key={section.key}>
                                {section.subItems && section.subItems.length > 0 ? (
                                  <>
                                    <button
                                      type="button"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => toggleSection(section.key)}
                                      className={[
                                        'flex w-full items-center gap-2 rounded-apple-sm px-3 py-1.5 text-apple-xs font-medium transition-colors',
                                        sectionActive
                                          ? 'text-apple-blue'
                                          : 'text-apple-text-secondary hover:text-apple-text',
                                      ].join(' ')}
                                    >
                                      <span className={sectionActive ? 'text-apple-blue' : 'text-apple-text-tertiary'}>
                                        {section.icon}
                                      </span>
                                      <span className="flex-1 text-left">{section.label}</span>
                                      <ChevronDown
                                        className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-0' : '-rotate-90'}`}
                                      />
                                    </button>
                                    {isOpen && (
                                      <ul className="ml-3 space-y-0.5 border-l border-apple-divider/60 pl-3">
                                        {section.subItems.map((s) => (
                                          <li key={s.label}>
                                            <SubNavLink href={s.href(loc.slug)} currentPath={pathname} exact={s.exact}>
                                              {s.label}
                                            </SubNavLink>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </>
                                ) : (
                                  <Link
                                    href={sectionHref}
                                    className={[
                                      'flex items-center gap-2 rounded-apple-sm px-3 py-1.5 text-apple-xs font-medium transition-colors',
                                      sectionActive
                                        ? 'text-apple-blue'
                                        : 'text-apple-text-secondary hover:text-apple-text',
                                    ].join(' ')}
                                  >
                                    <span className={sectionActive ? 'text-apple-blue' : 'text-apple-text-tertiary'}>
                                      {section.icon}
                                    </span>
                                    {section.label}
                                  </Link>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                    );
                  })}
                </ul>
              )}
            </li>
          </ul>

          <SectionHeader className="mt-6">Organization Settings</SectionHeader>
          <ul className="space-y-0.5">
            <li>
              <NavLink href="/admin" currentPath={pathname} icon={<LayoutDashboard className="h-4 w-4" />} exact>
                Overview
              </NavLink>
            </li>
            <li>
              <NavLink href="/admin/admins" currentPath={pathname} icon={<ShieldCheck className="h-4 w-4" />}>
                Admins
              </NavLink>
            </li>
            <li>
              <NavLink href="/admin/bay-app" currentPath={pathname} icon={<AppWindow className="h-4 w-4" />}>
                Bay App
              </NavLink>
            </li>
            <li>
              <NavLink href="/admin/settings" currentPath={pathname} icon={<SettingsIcon className="h-4 w-4" />}>
                General
              </NavLink>
            </li>
          </ul>
        </nav>

        <div className="border-t border-apple-divider p-3">
          <a
            href="/admin/logout"
            className="flex items-center gap-2.5 rounded-apple-sm px-3 py-2.5 text-apple-sm font-medium text-apple-text-secondary transition-colors duration-150 hover:bg-apple-red/5 hover:text-apple-red"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </a>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-apple-divider bg-white/80 backdrop-blur-xl">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-apple-sm p-2 text-apple-text-secondary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            <Breadcrumbs items={crumbs} />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

function SectionHeader({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={`mb-1 px-3 pt-2 pb-1.5 text-apple-xs font-semibold uppercase tracking-wider text-apple-text-tertiary ${className}`}>
      {children}
    </div>
  );
}

function NavLink({
  href,
  currentPath,
  children,
  icon,
  exact = false,
}: PropsWithChildren<{ href: string; currentPath: string | null; icon?: React.ReactNode; exact?: boolean }>) {
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
      {icon && <span className={active ? 'text-white' : 'text-apple-text-tertiary'}>{icon}</span>}
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
        'block rounded-apple-sm px-3 py-1.5 text-apple-xs transition-colors duration-150',
        active
          ? 'font-semibold text-apple-blue bg-apple-blue/5'
          : 'text-apple-text-secondary hover:bg-apple-fill-secondary hover:text-apple-text',
      ].join(' ')}
    >
      {children}
    </Link>
  );
}

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
                <span className="max-w-[28ch] truncate font-medium text-apple-text">{c.label}</span>
              ) : (
                <Link href={c.href} className="max-w-[28ch] truncate text-apple-text-secondary transition-colors hover:text-apple-blue">
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

function buildBreadcrumbs(pathname: string | null): Crumb[] {
  if (!pathname) return [{ label: 'Admin', href: '/admin' }];

  const parts = pathname.split('/').filter(Boolean);
  const crumbs: Crumb[] = [{ label: 'Admin', href: '/admin' }];

  let acc = '/admin';
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    acc += '/' + seg;
    crumbs.push({ label: titleizeSegment(seg), href: i === parts.length - 1 ? undefined : acc });
  }
  return crumbs;
}

function titleizeSegment(s: string) {
  const map: Record<string, string> = {
    locations: 'Locations',
    notifications: 'Notifications',
    bookings: 'Bookings',
    admins: 'Admins',
    bays: 'Bays',
    members: 'Members',
    'bay-app': 'Bay App',
    franchise: 'Franchise',
    scheduling: 'Scheduling',
    billing: 'Billing',
    marketing: 'Marketing',
    settings: 'Settings',
    documents: 'Documents',
    attendance: 'Attendance',
    memberships: 'Memberships',
    payments: 'Payments',
    recurring: 'Recurring',
    discounts: 'Discounts',
    accounting: 'Accounting',
    visitors: 'Visitors',
    messaging: 'Messaging',
    templates: 'Templates',
    automations: 'Automations',
    referrals: 'Referrals',
    'signup-forms': 'Signup Forms',
    tags: 'Tags',
    'custom-fields': 'Custom Fields',
    list: 'List',
    overview: 'Overview',
    dashboard: 'Dashboard',
    kisi: 'Kisi Doors',
    comms: 'Communications',
    tax: 'Tax',
    hours: 'Hours & Rules',
  };
  return map[s] ?? s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
