"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React from "react";
import { ChevronDown, ChevronRight, LogOut, Menu, MoreHorizontal, X, Check, MapPin, AlertTriangle } from "lucide-react";
import {
  adminRoutes,
  LOCATION_NAV,
  ORG_NAV,
  MOBILE_TAB_SECTION_KEYS,
  enumerateRoutePaths,
  isPathActive,
  labelForSegment,
  slugFromPathname,
} from "@/lib/admin/routes";
import { ToastProvider } from "@/components/ui/Toast";
import { NavIcon } from "./NavIcon";
import { cn } from "@/lib/utils";

export type ShellLocation = { id: string; name: string; slug: string; disabled: boolean };
export type ShellAdmin = { id: string; name: string | null; phone: string; role: "ROOT" | "FULL" | "SCOPED" };
/** Server-resolved extras (optional so other callers don't break). */
export type ShellMeta = {
  /** Unread admin notifications for the badge next to "Notifications". */
  unreadCount?: number;
  /** Org-level delivery switches; a banner shows when either is off. */
  comms?: { emailEnabled: boolean; smsEnabled: boolean };
};

const OPEN_SECTIONS_KEY = "tee24-admin:open-sections";
const BARE_PATHS = new Set([adminRoutes.login(), adminRoutes.logout()]);

/* ────────────────────────────────────────────────────────────────────────── */

export function AdminShell({
  admin,
  locations,
  meta,
  children,
}: {
  admin: ShellAdmin | null;
  locations: ShellLocation[];
  meta?: ShellMeta;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Login / logout render without chrome.
  if (!admin || (pathname && BARE_PATHS.has(pathname))) {
    return <ToastProvider>{children}</ToastProvider>;
  }

  return (
    <ToastProvider>
      <Chrome admin={admin} locations={locations} pathname={pathname ?? "/admin"} meta={meta}>
        {children}
      </Chrome>
    </ToastProvider>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function Chrome({
  admin,
  locations,
  pathname,
  meta,
  children,
}: {
  admin: ShellAdmin;
  locations: ShellLocation[];
  pathname: string;
  meta?: ShellMeta;
  children: React.ReactNode;
}) {
  const unread = meta?.unreadCount ?? 0;
  const pausedChannels = [
    meta?.comms && !meta.comms.emailEnabled ? "email" : null,
    meta?.comms && !meta.comms.smsEnabled ? "SMS" : null,
  ].filter((x): x is string => Boolean(x));
  const activeSlug = slugFromPathname(pathname);
  const activeLocation = React.useMemo(
    () => (activeSlug ? locations.find((l) => l.slug === activeSlug) ?? null : null),
    [activeSlug, locations]
  );

  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // Close the mobile drawer on navigation and lock body scroll while open.
  React.useEffect(() => setDrawerOpen(false), [pathname]);
  React.useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  const crumbs = React.useMemo(() => buildBreadcrumbs(pathname, activeLocation), [pathname, activeLocation]);
  const title = crumbs[crumbs.length - 1]?.label ?? "Admin";

  return (
    <div className="flex min-h-dvh bg-apple-bg text-apple-text">
      {/* Skip link */}
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-apple-sm focus:bg-white focus:px-3 focus:py-2 focus:shadow-apple-md"
      >
        Skip to content
      </a>

      {/* Mobile drawer backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar (drawer on mobile, static on desktop) */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[min(86vw,300px)] flex-col border-r border-apple-divider bg-white transition-transform duration-200 ease-out",
          "lg:static lg:z-auto lg:w-[272px] lg:translate-x-0 lg:shrink-0",
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Admin navigation"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-apple-divider px-4">
          <Link href={adminRoutes.home()} className="flex items-center gap-2 text-apple-lg font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-apple-sm bg-apple-blue text-[11px] font-bold text-white">
              T24
            </span>
            Tee24
          </Link>
          <button
            onClick={() => setDrawerOpen(false)}
            className="rounded-apple-sm p-2 text-apple-text-tertiary hover:bg-apple-fill-secondary hover:text-apple-text lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-3" style={{ overflowAnchor: "none" }}>
          <LocationSwitcher locations={locations} active={activeLocation} />

          {activeLocation ? (
            <LocationSections slug={activeLocation.slug} pathname={pathname} />
          ) : (
            <p className="mt-3 px-3 text-apple-xs text-apple-text-tertiary">
              Choose a location to manage scheduling, members, billing, and marketing.
            </p>
          )}

          <SectionLabel className="mt-6">Organization</SectionLabel>
          <ul className="space-y-0.5">
            {ORG_NAV.map((item) => (
              <li key={item.href}>
                <NavRow href={item.href} active={isPathActive(pathname, item.href, item.exact)} icon={item.icon}>
                  <span className="flex flex-1 items-center justify-between gap-2">
                    {item.label}
                    {item.href === adminRoutes.notifications() && unread > 0 && (
                      <span
                        className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-apple-pill bg-apple-red px-1.5 text-[11px] font-semibold leading-none text-white"
                        aria-label={`${unread} unread notifications`}
                      >
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </span>
                </NavRow>
              </li>
            ))}
          </ul>
        </nav>

        <div className="shrink-0 border-t border-apple-divider p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-3 rounded-apple-sm px-2 py-1.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-fill-secondary text-apple-xs font-semibold text-apple-text-secondary">
              {initials(admin.name) || "A"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-apple-sm font-medium">{admin.name || admin.phone}</div>
              <div className="text-apple-xs text-apple-text-tertiary">{roleLabel(admin.role)}</div>
            </div>
            <a
              href={adminRoutes.logout()}
              className="rounded-apple-sm p-2 text-apple-text-tertiary hover:bg-apple-red/5 hover:text-apple-red"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </a>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-apple-divider bg-white/85 backdrop-blur-xl">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-6">
            <button
              onClick={() => setDrawerOpen(true)}
              className="rounded-apple-sm p-2 text-apple-text-secondary hover:bg-apple-fill-secondary hover:text-apple-text lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Mobile: current page title. Desktop: breadcrumbs. */}
            <div className="min-w-0 flex-1">
              <div className="truncate text-apple-base font-semibold lg:hidden">{title}</div>
              <Breadcrumbs items={crumbs} className="hidden lg:flex" />
            </div>

            {activeLocation && (
              <span className="hidden items-center gap-1.5 rounded-apple-pill border border-apple-border bg-white px-3 py-1 text-apple-xs text-apple-text-secondary sm:inline-flex">
                <MapPin className="h-3 w-3" />
                {activeLocation.name}
              </span>
            )}
          </div>
        </header>

        {pausedChannels.length > 0 && (
          <div
            role="status"
            className="flex items-center gap-2 border-b border-apple-orange/30 bg-apple-orange/10 px-3 py-2 text-apple-xs text-apple-orange sm:px-6"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              Outbound <span className="font-semibold">{pausedChannels.join(" and ")}</span> is paused organization-wide. Members won&apos;t receive messages on{" "}
              {pausedChannels.length > 1 ? "these channels" : "this channel"}.
            </span>
            {(admin.role === "ROOT" || admin.role === "FULL") && (
              <Link href={adminRoutes.settingsEmail()} className="shrink-0 font-semibold underline-offset-2 hover:underline">
                Manage
              </Link>
            )}
          </div>
        )}

        <main
          id="admin-main"
          className={cn(
            "mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-6 sm:py-6",
            activeLocation ? "pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-6" : ""
          )}
        >
          {children}
        </main>
      </div>

      {activeLocation && (
        <MobileTabBar slug={activeLocation.slug} pathname={pathname} onMore={() => setDrawerOpen(true)} />
      )}
    </div>
  );
}

/* ───────────────────────────── Location switcher ───────────────────────── */

function LocationSwitcher({ locations, active }: { locations: ShellLocation[]; active: ShellLocation | null }) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-apple border px-3 py-2.5 text-left transition-colors",
          "border-apple-border bg-apple-fill-secondary hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/30"
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-apple-sm bg-white text-apple-blue shadow-apple">
          <MapPin className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-apple-text-tertiary">Location</span>
          <span className="block truncate text-apple-sm font-semibold">{active?.name ?? "Choose a location"}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-apple-text-tertiary transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-10 mt-1 max-h-72 overflow-y-auto rounded-apple border border-apple-border bg-white p-1 shadow-apple-lg"
        >
          {locations.length === 0 && (
            <div className="px-3 py-2 text-apple-sm text-apple-text-tertiary">No locations available</div>
          )}
          {locations.map((l) => {
            const selected = l.slug === active?.slug;
            return (
              <button
                key={l.id}
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setOpen(false);
                  router.push(adminRoutes.loc.dashboard(l.slug));
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-apple-sm px-3 py-2 text-left text-apple-sm hover:bg-apple-fill-secondary",
                  selected && "font-semibold text-apple-blue"
                )}
              >
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                {l.disabled && (
                  <span className="rounded-full bg-apple-red/10 px-1.5 text-[10px] font-medium text-apple-red">Disabled</span>
                )}
                {selected && <Check className="h-4 w-4" />}
              </button>
            );
          })}
          <div className="my-1 border-t border-apple-divider" />
          <Link
            href={adminRoutes.locations()}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-apple-sm px-3 py-2 text-apple-sm text-apple-text-secondary hover:bg-apple-fill-secondary hover:text-apple-text"
          >
            Manage all locations
            <ChevronRight className="ml-auto h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Location sections ───────────────────────── */

function LocationSections({ slug, pathname }: { slug: string; pathname: string }) {
  const [openKeys, setOpenKeys] = React.useState<Record<string, boolean>>({});
  const hydrated = React.useRef(false);

  // Restore persisted open/closed state once.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(OPEN_SECTIONS_KEY);
      if (raw) setOpenKeys(JSON.parse(raw));
    } catch {}
    hydrated.current = true;
  }, []);

  React.useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(openKeys));
    } catch {}
  }, [openKeys]);

  // Auto-open the section containing the current page (without closing others).
  React.useEffect(() => {
    const current = LOCATION_NAV.find((s) =>
      s.items.length ? s.items.some((i) => isPathActive(pathname, i.href(slug), i.exact)) : isPathActive(pathname, s.href(slug))
    );
    if (current && !openKeys[current.key]) {
      setOpenKeys((cur) => ({ ...cur, [current.key]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, slug]);

  return (
    <ul className="mt-3 space-y-0.5">
      {LOCATION_NAV.map((section) => {
        const sectionHref = section.href(slug);
        const sectionActive = section.items.length
          ? section.items.some((i) => isPathActive(pathname, i.href(slug), i.exact)) ||
            isPathActive(pathname, sectionRootFor(section.key, slug))
          : isPathActive(pathname, sectionHref);

        if (section.items.length === 0) {
          return (
            <li key={section.key}>
              <NavRow href={sectionHref} active={sectionActive} icon={section.icon}>
                {section.label}
              </NavRow>
            </li>
          );
        }

        const isOpen = openKeys[section.key] ?? false;
        return (
          <li key={section.key}>
            <button
              type="button"
              onClick={() => setOpenKeys((cur) => ({ ...cur, [section.key]: !isOpen }))}
              aria-expanded={isOpen}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-apple-sm px-3 py-2 text-apple-sm font-medium transition-colors",
                sectionActive ? "text-apple-blue" : "text-apple-text-secondary hover:bg-apple-fill-secondary hover:text-apple-text"
              )}
            >
              <span className={sectionActive ? "text-apple-blue" : "text-apple-text-tertiary"}>
                <NavIcon name={section.icon} />
              </span>
              <span className="flex-1 text-left">{section.label}</span>
              <ChevronDown className={cn("h-4 w-4 text-apple-text-tertiary transition-transform", !isOpen && "-rotate-90")} />
            </button>
            {isOpen && (
              <ul className="ml-[1.35rem] mt-0.5 space-y-0.5 border-l border-apple-divider pl-3">
                {section.items.map((item) => {
                  const href = item.href(slug);
                  const active = isPathActive(pathname, href, item.exact);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "block rounded-apple-sm px-3 py-1.5 text-apple-sm transition-colors",
                          active
                            ? "bg-apple-blue/5 font-semibold text-apple-blue"
                            : "text-apple-text-secondary hover:bg-apple-fill-secondary hover:text-apple-text"
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Root path for a section (used so e.g. /scheduling highlights the Scheduling section). */
function sectionRootFor(key: string, slug: string): string {
  switch (key) {
    case "scheduling": return adminRoutes.loc.scheduling.root(slug);
    case "members": return adminRoutes.loc.members.root(slug);
    case "billing": return adminRoutes.loc.billing.root(slug);
    case "marketing": return adminRoutes.loc.marketing.root(slug);
    case "settings": return `${adminRoutes.loc.root(slug)}/settings`;
    default: return adminRoutes.loc.dashboard(slug);
  }
}

/* ───────────────────────────── Mobile tab bar ──────────────────────────── */

function MobileTabBar({ slug, pathname, onMore }: { slug: string; pathname: string; onMore: () => void }) {
  const tabs = LOCATION_NAV.filter((s) => (MOBILE_TAB_SECTION_KEYS as readonly string[]).includes(s.key));
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-apple-divider bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      aria-label="Quick navigation"
    >
      <ul className="grid grid-cols-5">
        {tabs.map((s) => {
          const href = s.href(slug);
          const active = s.items.length
            ? s.items.some((i) => isPathActive(pathname, i.href(slug), i.exact)) || isPathActive(pathname, sectionRootFor(s.key, slug))
            : isPathActive(pathname, href);
          return (
            <li key={s.key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium",
                  active ? "text-apple-blue" : "text-apple-text-tertiary"
                )}
              >
                <NavIcon name={s.icon} className="h-5 w-5" />
                {s.label === "Location Settings" ? "Settings" : s.label}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            onClick={onMore}
            className="flex h-14 w-full flex-col items-center justify-center gap-1 text-[10px] font-medium text-apple-text-tertiary"
          >
            <MoreHorizontal className="h-5 w-5" />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}

/* ───────────────────────────── Breadcrumbs ─────────────────────────────── */

type Crumb = { label: string; href?: string };

// Routes that exist (with placeholders) — crumbs only link to known pages.
const KNOWN_PATHS = new Set(enumerateRoutePaths());

function buildBreadcrumbs(pathname: string, location: ShellLocation | null): Crumb[] {
  const parts = pathname.split("/").filter(Boolean); // ["admin", ...]
  const crumbs: Crumb[] = [{ label: "Admin", href: adminRoutes.home() }];
  if (parts.length <= 1) return [{ label: "Overview" }];

  let acc = "/admin";
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    acc += `/${seg}`;
    const isLast = i === parts.length - 1;

    // Replace the location slug segment with the location name.
    let label = labelForSegment(decodeSafe(seg));
    if (location && parts[i - 1] === "locations" && decodeSafe(seg) === location.slug) label = location.name;

    // Skip pure container segments that have no page of their own (e.g. ".../settings").
    const probe = acc.replace(/\/admin\/locations\/[^/]+/, "/admin/locations/__slug__");
    const linkable = KNOWN_PATHS.has(probe);
    if (!isLast && !linkable && !(location && parts[i - 1] === "locations")) continue;

    crumbs.push({ label, href: isLast ? undefined : linkable ? acc : undefined });
  }
  return crumbs;
}

function Breadcrumbs({ items, className = "" }: { items: Crumb[]; className?: string }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-1.5 text-apple-sm">
        {items.map((c, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <span className="text-apple-text-tertiary">/</span>}
              {isLast || !c.href ? (
                <span className={cn("max-w-[32ch] truncate", isLast ? "font-semibold text-apple-text" : "text-apple-text-secondary")} aria-current={isLast ? "page" : undefined}>
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="max-w-[32ch] truncate text-apple-text-secondary hover:text-apple-blue">
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

/* ───────────────────────────── Small pieces ────────────────────────────── */

function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-1 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-apple-text-tertiary", className)}>
      {children}
    </div>
  );
}

function NavRow({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ComponentProps<typeof NavIcon>["name"];
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-apple-sm px-3 py-2 text-apple-sm font-medium transition-colors",
        active ? "bg-apple-blue text-white" : "text-apple-text-secondary hover:bg-apple-fill-secondary hover:text-apple-text"
      )}
    >
      <span className={active ? "text-white" : "text-apple-text-tertiary"}>
        <NavIcon name={icon} />
      </span>
      {children}
    </Link>
  );
}

function initials(name: string | null): string {
  if (!name) return "";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function roleLabel(role: ShellAdmin["role"]): string {
  return role === "ROOT" ? "Root admin" : role === "FULL" ? "Full access" : "Location admin";
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
