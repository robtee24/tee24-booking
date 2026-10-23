/**
 * Single source of truth for every admin URL.
 *
 * Rules:
 *  1. Never hand-write "/admin/..." strings in components. Use `adminRoutes`.
 *  2. Every route here must have a matching `page.tsx` under `app/`. The
 *     `scripts/verify-admin-routes.mjs` script runs on `prebuild` and fails the
 *     build if any route in this file (or in ADMIN_NAV) has no page — so a
 *     dead link can never ship to production.
 *  3. The sidebar (ADMIN_NAV / LOCATION_NAV) and breadcrumbs are generated from
 *     this file, so navigation and pages can't drift apart.
 *
 * This module is imported by both client and server components — keep it free
 * of server-only imports.
 */

const enc = (s: string) => encodeURIComponent(s);

export const MEMBER_PROFILE_TABS = [
  "memberships",
  "payments",
  "documents",
  "attendance",
  "messaging",
  "family",
  "notes",
] as const;
export type MemberProfileTab = (typeof MEMBER_PROFILE_TABS)[number];

export const adminRoutes = {
  // ── Auth ────────────────────────────────────────────────────────────────
  login: () => "/admin/login",
  logout: () => "/admin/logout",

  // ── Organization level ──────────────────────────────────────────────────
  home: () => "/admin",
  franchise: () => "/admin/franchise",
  locations: () => "/admin/locations",
  admins: () => "/admin/admins",
  adminNew: () => "/admin/admins/new",
  adminDetail: (id: string) => `/admin/admins/${enc(id)}`,
  bayApp: () => "/admin/bay-app",
  checkIns: () => "/admin/check-ins",
  checkInAnalytics: () => "/admin/check-ins/analytics",
  doorAccess: () => "/admin/door-access",
  inbox: () => "/admin/inbox",
  tasks: () => "/admin/tasks",
  notifications: () => "/admin/notifications",
  settings: () => "/admin/settings",
  settingsAuditLog: () => "/admin/settings/audit-log",
  settingsHealth: () => "/admin/settings/health",
  settingsMigration: () => "/admin/settings/migration",
  settingsChurnModel: () => "/admin/settings/churn-model",
  settingsEmail: () => "/admin/settings/email",

  // ── Per-location ────────────────────────────────────────────────────────
  loc: {
    root: (slug: string) => `/admin/locations/${enc(slug)}`,
    dashboard: (slug: string) => `/admin/locations/${enc(slug)}/dashboard`,
    troubleshoot: (slug: string) => `/admin/locations/${enc(slug)}/troubleshoot`,
    checkIns: (slug: string) => `/admin/locations/${enc(slug)}/check-ins`,
    checkInAnalytics: (slug: string) => `/admin/locations/${enc(slug)}/check-ins/analytics`,

    scheduling: {
      root: (slug: string) => `/admin/locations/${enc(slug)}/scheduling`,
      bookings: (slug: string) => `/admin/locations/${enc(slug)}/scheduling/bookings`,
      bays: (slug: string) => `/admin/locations/${enc(slug)}/scheduling/bays`,
      notifications: (slug: string) => `/admin/locations/${enc(slug)}/scheduling/notifications`,
      maintenance: (slug: string) => `/admin/locations/${enc(slug)}/scheduling/maintenance`,
    },

    members: {
      root: (slug: string) => `/admin/locations/${enc(slug)}/members`,
      list: (slug: string) => `/admin/locations/${enc(slug)}/members/list`,
      new: (slug: string) => `/admin/locations/${enc(slug)}/members/list/new`,
      detail: (slug: string, id: string) => `/admin/locations/${enc(slug)}/members/list/${enc(id)}`,
      detailTab: (slug: string, id: string, tab: MemberProfileTab) =>
        `/admin/locations/${enc(slug)}/members/list/${enc(id)}/${tab}`,
      import: (slug: string) => `/admin/locations/${enc(slug)}/members/settings/import`,
      merge: (slug: string) => `/admin/locations/${enc(slug)}/members/settings/merge`,
      memberships: (slug: string) => `/admin/locations/${enc(slug)}/members/memberships`,
      membershipNew: (slug: string) => `/admin/locations/${enc(slug)}/members/memberships/new`,
      documents: (slug: string) => `/admin/locations/${enc(slug)}/members/documents`,
      documentNew: (slug: string) => `/admin/locations/${enc(slug)}/members/documents/new`,
      attendance: (slug: string) => `/admin/locations/${enc(slug)}/members/attendance`,
      tags: (slug: string) => `/admin/locations/${enc(slug)}/members/tags`,
      customFields: (slug: string) => `/admin/locations/${enc(slug)}/members/custom-fields`,
      settings: (slug: string) => `/admin/locations/${enc(slug)}/members/settings`,
    },

    billing: {
      root: (slug: string) => `/admin/locations/${enc(slug)}/billing`,
      payments: (slug: string) => `/admin/locations/${enc(slug)}/billing/payments`,
      recurring: (slug: string) => `/admin/locations/${enc(slug)}/billing/recurring`,
      discounts: (slug: string) => `/admin/locations/${enc(slug)}/billing/discounts`,
      discountNew: (slug: string) => `/admin/locations/${enc(slug)}/billing/discounts/new`,
      discountDetail: (slug: string, id: string) => `/admin/locations/${enc(slug)}/billing/discounts/${enc(id)}`,
      invoiceDetail: (slug: string, id: string) => `/admin/locations/${enc(slug)}/billing/invoices/${enc(id)}`,
      accounting: (slug: string) => `/admin/locations/${enc(slug)}/billing/accounting`,
      settings: (slug: string) => `/admin/locations/${enc(slug)}/billing/settings`,
    },

    marketing: {
      root: (slug: string) => `/admin/locations/${enc(slug)}/marketing`,
      visitors: (slug: string) => `/admin/locations/${enc(slug)}/marketing/visitors`,
      messaging: (slug: string) => `/admin/locations/${enc(slug)}/marketing/messaging`,
      compose: (slug: string) => `/admin/locations/${enc(slug)}/marketing/messaging/compose`,
      templates: (slug: string) => `/admin/locations/${enc(slug)}/marketing/templates`,
      automations: (slug: string) => `/admin/locations/${enc(slug)}/marketing/automations`,
      automationNew: (slug: string) => `/admin/locations/${enc(slug)}/marketing/automations/new`,
      automationDetail: (slug: string, id: string) => `/admin/locations/${enc(slug)}/marketing/automations/${enc(id)}`,
      inbox: (slug: string) => `/admin/locations/${enc(slug)}/marketing/inbox`,
      referrals: (slug: string) => `/admin/locations/${enc(slug)}/marketing/referrals`,
      signupForms: (slug: string) => `/admin/locations/${enc(slug)}/marketing/signup-forms`,
      signupFormNew: (slug: string) => `/admin/locations/${enc(slug)}/marketing/signup-forms/new`,
      signupFormDetail: (slug: string, id: string) => `/admin/locations/${enc(slug)}/marketing/signup-forms/${enc(id)}`,
      settings: (slug: string) => `/admin/locations/${enc(slug)}/marketing/settings`,
    },

    sales: {
      root: (slug: string) => `/admin/locations/${enc(slug)}/sales`,
      list: (slug: string) => `/admin/locations/${enc(slug)}/sales/list`,
      products: (slug: string) => `/admin/locations/${enc(slug)}/sales/products`,
      productNew: (slug: string) => `/admin/locations/${enc(slug)}/sales/products/new`,
      productDetail: (slug: string, id: string) => `/admin/locations/${enc(slug)}/sales/products/${enc(id)}`,
      giftCards: (slug: string) => `/admin/locations/${enc(slug)}/sales/gift-cards`,
      report: (slug: string) => `/admin/locations/${enc(slug)}/sales/report`,
    },

    settings: {
      details: (slug: string) => `/admin/locations/${enc(slug)}`,
      hours: (slug: string) => `/admin/locations/${enc(slug)}/settings/hours`,
      bayApp: (slug: string) => `/admin/locations/${enc(slug)}/settings/bay-app`,
      kisi: (slug: string) => `/admin/locations/${enc(slug)}/settings/kisi`,
      comms: (slug: string) => `/admin/locations/${enc(slug)}/settings/comms`,
      tax: (slug: string) => `/admin/locations/${enc(slug)}/settings/tax`,
      admins: (slug: string) => `/admin/locations/${enc(slug)}/settings/admins`,
    },
  },
} as const;

/* ────────────────────────────────────────────────────────────────────────── */
/* Navigation model (consumed by the sidebar, mobile tab bar, breadcrumbs)   */
/* ────────────────────────────────────────────────────────────────────────── */

export type NavIcon =
  | "dashboard" | "calendar" | "users" | "card" | "megaphone" | "settings"
  | "building" | "map-pin" | "shield" | "app-window" | "bell" | "check-square" | "wrench"
  | "door-open" | "log-in" | "inbox";

export type NavLeaf = {
  label: string;
  href: (slug: string) => string;
  /** Highlight only on exact match (for section "overview" pages) */
  exact?: boolean;
};

export type NavSection = {
  key: string;
  label: string;
  icon: NavIcon;
  /** Landing page for the section (used by the mobile tab bar) */
  href: (slug: string) => string;
  items: NavLeaf[];
};

/** Per-location information architecture. */
export const LOCATION_NAV: NavSection[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: "dashboard",
    href: adminRoutes.loc.dashboard,
    items: [],
  },
  {
    key: "check-ins",
    label: "Check Ins",
    icon: "log-in",
    href: adminRoutes.loc.checkIns,
    items: [],
  },
  {
    key: "scheduling",
    label: "Scheduling",
    icon: "calendar",
    href: adminRoutes.loc.scheduling.bookings,
    items: [
      { label: "Bookings", href: adminRoutes.loc.scheduling.bookings },
      { label: "Bays", href: adminRoutes.loc.scheduling.bays },
      { label: "Notifications", href: adminRoutes.loc.scheduling.notifications },
      { label: "Maintenance", href: adminRoutes.loc.scheduling.maintenance },
    ],
  },
  {
    key: "members",
    label: "Members",
    icon: "users",
    href: adminRoutes.loc.members.list,
    items: [
      { label: "List", href: adminRoutes.loc.members.list },
      { label: "Memberships", href: adminRoutes.loc.members.memberships },
      { label: "Documents", href: adminRoutes.loc.members.documents },
      { label: "Attendance", href: adminRoutes.loc.members.attendance },
      { label: "Tags", href: adminRoutes.loc.members.tags },
      { label: "Custom Fields", href: adminRoutes.loc.members.customFields },
      { label: "Member Settings", href: adminRoutes.loc.members.settings },
    ],
  },
  {
    key: "billing",
    label: "Billing",
    icon: "card",
    href: adminRoutes.loc.billing.root,
    items: [
      { label: "Overview", href: adminRoutes.loc.billing.root, exact: true },
      { label: "Payments", href: adminRoutes.loc.billing.payments },
      { label: "Recurring", href: adminRoutes.loc.billing.recurring },
      { label: "Discounts", href: adminRoutes.loc.billing.discounts },
      { label: "Accounting", href: adminRoutes.loc.billing.accounting },
      { label: "Settings", href: adminRoutes.loc.billing.settings },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    icon: "card",
    href: adminRoutes.loc.sales.root,
    items: [
      { label: "New Sale", href: adminRoutes.loc.sales.root, exact: true },
      { label: "Sales", href: adminRoutes.loc.sales.list },
      { label: "Products", href: adminRoutes.loc.sales.products },
      { label: "Gift Cards", href: adminRoutes.loc.sales.giftCards },
      { label: "Report", href: adminRoutes.loc.sales.report },
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    icon: "megaphone",
    href: adminRoutes.loc.marketing.root,
    items: [
      { label: "Dashboard", href: adminRoutes.loc.marketing.root, exact: true },
      { label: "Visitors", href: adminRoutes.loc.marketing.visitors },
      { label: "Messaging", href: adminRoutes.loc.marketing.messaging },
      { label: "Inbox", href: adminRoutes.loc.marketing.inbox },
      { label: "Templates", href: adminRoutes.loc.marketing.templates },
      { label: "Automations", href: adminRoutes.loc.marketing.automations },
      { label: "Referrals", href: adminRoutes.loc.marketing.referrals },
      { label: "Signup Forms", href: adminRoutes.loc.marketing.signupForms },
      { label: "Settings", href: adminRoutes.loc.marketing.settings },
    ],
  },
  {
    key: "troubleshoot",
    label: "Troubleshoot",
    icon: "wrench",
    href: adminRoutes.loc.troubleshoot,
    items: [],
  },
  {
    key: "settings",
    label: "Location Settings",
    icon: "settings",
    href: adminRoutes.loc.settings.details,
    items: [
      { label: "Details", href: adminRoutes.loc.settings.details, exact: true },
      { label: "Hours", href: adminRoutes.loc.settings.hours },
      { label: "Bay Kiosk", href: adminRoutes.loc.settings.bayApp },
      { label: "Kisi Doors", href: adminRoutes.loc.settings.kisi },
      { label: "Communications", href: adminRoutes.loc.settings.comms },
      { label: "Tax", href: adminRoutes.loc.settings.tax },
      { label: "Admins", href: adminRoutes.loc.settings.admins },
    ],
  },
];

export type OrgNavItem = { label: string; href: string; icon: NavIcon; exact?: boolean };

/** Organization-level navigation (not tied to a location). */
export const ORG_NAV: OrgNavItem[] = [
  { label: "Overview", href: adminRoutes.home(), icon: "dashboard", exact: true },
  { label: "Franchise", href: adminRoutes.franchise(), icon: "building" },
  { label: "Locations", href: adminRoutes.locations(), icon: "map-pin", exact: true },
  { label: "Check Ins", href: adminRoutes.checkIns(), icon: "log-in" },
  { label: "Door Access", href: adminRoutes.doorAccess(), icon: "door-open" },
  { label: "Inbox", href: adminRoutes.inbox(), icon: "inbox" },
  { label: "Admins", href: adminRoutes.admins(), icon: "shield" },
  { label: "Tasks", href: adminRoutes.tasks(), icon: "check-square" },
  { label: "Notifications", href: adminRoutes.notifications(), icon: "bell" },
  { label: "Bay Kiosk App", href: adminRoutes.bayApp(), icon: "app-window" },
  { label: "Settings", href: adminRoutes.settings(), icon: "settings" },
];

/** Sections shown in the mobile bottom tab bar when inside a location. */
export const MOBILE_TAB_SECTION_KEYS = ["dashboard", "scheduling", "members", "billing"] as const;

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/** Extract the location slug from an admin pathname, if any. */
export function slugFromPathname(pathname: string | null | undefined): string | null {
  const m = pathname?.match(/^\/admin\/locations\/([^/]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export function isPathActive(pathname: string | null, href: string, exact = false): boolean {
  if (!pathname) return false;
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

/** Human-readable labels for URL segments (used by breadcrumbs). */
export const SEGMENT_LABELS: Record<string, string> = {
  admin: "Admin",
  locations: "Locations",
  dashboard: "Dashboard",
  troubleshoot: "Troubleshoot",
  scheduling: "Scheduling",
  bookings: "Bookings",
  bays: "Bays",
  notifications: "Notifications",
  maintenance: "Maintenance",
  members: "Members",
  list: "List",
  new: "New",
  memberships: "Memberships",
  documents: "Documents",
  attendance: "Attendance",
  tags: "Tags",
  "custom-fields": "Custom Fields",
  billing: "Billing",
  payments: "Payments",
  recurring: "Recurring",
  discounts: "Discounts",
  accounting: "Accounting",
  marketing: "Marketing",
  visitors: "Visitors",
  messaging: "Messaging",
  compose: "Compose",
  templates: "Templates",
  automations: "Automations",
  referrals: "Referrals",
  "signup-forms": "Signup Forms",
  settings: "Settings",
  hours: "Hours & Booking Rules",
  "bay-app": "Bay Kiosk",
  kisi: "Kisi Doors",
  comms: "Communications",
  tax: "Tax",
  admins: "Admins",
  franchise: "Franchise",
  tasks: "Tasks",
  "audit-log": "Audit Log",
  health: "Integration Health",
  migration: "Migration",
  "churn-model": "Churn Model",
  "check-ins": "Check Ins",
  analytics: "Analytics",
  "door-access": "Door Access",
  sales: "Sales",
  products: "Products",
  "gift-cards": "Gift Cards",
  report: "Report",
  inbox: "Inbox",
  invoices: "Invoices",
  import: "Import",
  merge: "Merge Duplicates",
  email: "Email",
  family: "Family",
  notes: "Notes",
};

export function labelForSegment(seg: string): string {
  return SEGMENT_LABELS[seg] ?? seg.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Flatten every route in this file into concrete sample paths. Used by the
 * build-time verifier and by tests. Dynamic params get placeholder values.
 */
export function enumerateRoutePaths(): string[] {
  const SLUG = "__slug__";
  const ID = "__id__";
  const out = new Set<string>();

  const visit = (node: unknown) => {
    if (typeof node === "function") {
      const fn = node as (...a: string[]) => string;
      // Most routes take (slug) or (); a few take (slug, id) or (id).
      try {
        if (fn.length >= 3) {
          for (const tab of MEMBER_PROFILE_TABS) out.add(fn(SLUG, ID, tab));
        } else {
          out.add(fn(SLUG, ID));
        }
      } catch {
        out.add(fn(SLUG));
      }
      return;
    }
    if (node && typeof node === "object") {
      for (const v of Object.values(node as Record<string, unknown>)) visit(v);
    }
  };
  visit(adminRoutes);

  for (const s of LOCATION_NAV) {
    out.add(s.href(SLUG));
    for (const i of s.items) out.add(i.href(SLUG));
  }
  for (const o of ORG_NAV) out.add(o.href);

  return [...out].sort();
}
