// services/location.service.ts
import { getPrisma } from "@/lib/db";
import type {
  LocationListItem,
  PublicLocationInfo,
  AdminLocationDetails,
  CreateLocationInput,
  LocationHours,
} from "@/types/location";
import type { BayInfo } from "@/types/bay";

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: Single source of truth for location + bays
// ─────────────────────────────────────────────────────────────────────────────
async function getLocationWithBays(slug: string) {
  const location = await getPrisma().location.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      disabled: true,
      bookingNote: true,
      passAccessUrl: true,
      open24Hours: true,
      hours: true,
      timezone: true,
      minBookingMinutes: true,
      maxBookingMinutes: true,
      maxActiveBookingsPerGuest: true,
      activeBookingIdentifyBy: true,
      activeBookingWindowHours: true,
      maxConsecutiveBookingsPerGuest: true,
      createdAt: true,
      updatedAt: true,
      bays: {
        select: {
          id: true,
          number: true,
          name: true,
          kind: true,
          handedness: true,
          capacity: true,
          disabled: true,
        },
        orderBy: { number: "asc" },
      },
    },
  });

  if (!location) throw new Error("Location not found");

  const base = {
    id: location.id,
    name: location.name,
    slug: location.slug,
    disabled: location.disabled ?? false,
    bookingNote: location.bookingNote ?? "",
    passAccessUrl: location.passAccessUrl ?? null,
    open24Hours: location.open24Hours,
    hours: (location.hours ?? {}) as LocationHours,
    timezone: location.timezone ?? "America/New_York",
    minBookingMinutes: location.minBookingMinutes ?? 60,
    maxBookingMinutes: location.maxBookingMinutes ?? 120,
    maxActiveBookingsPerGuest: location.maxActiveBookingsPerGuest ?? 2,
    activeBookingIdentifyBy: (location.activeBookingIdentifyBy ?? "either") as "phone" | "email" | "either",
    activeBookingWindowHours: location.activeBookingWindowHours ?? 24,
    maxConsecutiveBookingsPerGuest: location.maxConsecutiveBookingsPerGuest ?? 2,
    createdAt: location.createdAt,
    updatedAt: location.updatedAt,
  };

  const bayNumbers = location.bays.map((b) => b.number);
  const bays: BayInfo[] = location.bays.map((b) => ({
    id: b.id,
    number: b.number,
    name: b.name ?? null,
    kind: b.kind,
    handedness: b.handedness,
    capacity: b.capacity,
    disabled: b.disabled ?? false,
  }));

  return { ...base, bayNumbers, bays };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET: Admin list (filtered by role/slugs)
// ─────────────────────────────────────────────────────────────────────────────
export async function getAdminLocations({
  role,
  locationSlugs,
}: {
  role: "ROOT" | "FULL" | "SCOPED";
  locationSlugs?: string[];
}): Promise<LocationListItem[]> {
  const where =
    role === "SCOPED" && locationSlugs?.length
      ? { slug: { in: locationSlugs } }
      : {};

  const locations = await getPrisma().location.findMany({
    where,
    select: {
      id: true,
      name: true,
      slug: true,
      disabled: true,
    },
    orderBy: { name: "asc" },
  });

  return locations.map((l) => ({
    id: l.id,
    name: l.name,
    slug: l.slug,
    disabled: l.disabled ?? false,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// GET: Public location info by slug
// ─────────────────────────────────────────────────────────────────────────────
export async function getPublicLocationInfo(slug: string): Promise<PublicLocationInfo> {
  const data = await getLocationWithBays(slug);

  const { disabled, createdAt, updatedAt, bays, ...publicFields } = data;

  return {
    ...publicFields,
    bayNumbers: data.bayNumbers,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET: Full admin location details by slug
// ─────────────────────────────────────────────────────────────────────────────
export async function getAdminLocationDetails(slug: string): Promise<AdminLocationDetails> {
  const data = await getLocationWithBays(slug);
  return {
    ...data,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET: All bays for a location (public — used by booking UI)
// ─────────────────────────────────────────────────────────────────────────────
export async function getLocationBays(slug: string): Promise<BayInfo[]> {
  const data = await getLocationWithBays(slug);
  return data.bays;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST: Create new location
// ─────────────────────────────────────────────────────────────────────────────
export async function createLocation(input: CreateLocationInput): Promise<LocationListItem> {
  const cleanName = input.name.trim();
  const cleanSlug = input.slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!cleanName || !cleanSlug) throw new Error("Invalid name or slug");

  const exists = await getPrisma().location.findUnique({
    where: { slug: cleanSlug },
  });
  if (exists) throw new Error("Slug already exists");

  return await getPrisma().$transaction(async (tx) => {
    const loc = await tx.location.create({
      data: {
        name: cleanName,
        slug: cleanSlug,
        bookingNote: "",
        hours: {} satisfies LocationHours, // explicit empty object
        timezone: "America/New_York",
        minBookingMinutes: 60,
        maxBookingMinutes: 120,
      },
      select: { id: true, name: true, slug: true },
    });

    const defaultEmail = `<p>Hi {{firstName}},</p>
<p>Confirmed for {{date}} {{startTime}}–{{endTime}} at <strong>{{locationName}}</strong>, Bay {{bayNumber}}.</p>
<p>{{bookingNote}}</p>
<p>Manage: <a href="{{manageUrl}}">{{manageUrl}}</a></p>`;

    const defaultSms = `Tee24: {{firstName}} your bay {{bayNumber}} at {{locationName}} is booked for {{date}} {{startTime}}–{{endTime}}. Manage: {{manageUrl}}`;

    await tx.notification.createMany({
      data: [
        {
          locationId: loc.id,
          kind: "CONFIRMATION",
          channel: "EMAIL",
          hoursBefore: 0,
          enabled: true,
          template: defaultEmail,
          order: 0,
        },
        {
          locationId: loc.id,
          kind: "CONFIRMATION",
          channel: "TEXT",
          hoursBefore: 0,
          enabled: true,
          template: defaultSms,
          order: 0,
        },
      ],
    });

    return {
      id: loc.id,
      name: loc.name,
      slug: loc.slug,
      disabled: false,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH: Enable/disable location
// ─────────────────────────────────────────────────────────────────────────────
export async function updateLocationDisabled({
  slug,
  disabled,
}: {
  slug: string;
  disabled: boolean;
}): Promise<LocationListItem> {
  const location = await getPrisma().location.update({
    where: { slug },
    data: { disabled },
    select: { id: true, name: true, slug: true, disabled: true },
  });

  return {
    id: location.id,
    name: location.name,
    slug: location.slug,
    disabled: location.disabled ?? false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH: Location details (name/business/contact/address/timezone/branding)
// ─────────────────────────────────────────────────────────────────────────────

/** Common US zones first; any valid IANA zone is accepted by `isValidTimezone`. */
export const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Arizona (Phoenix, no DST)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { value: "America/Puerto_Rico", label: "Atlantic (Puerto Rico)" },
  { value: "America/Toronto", label: "Eastern (Toronto)" },
  { value: "America/Vancouver", label: "Pacific (Vancouver)" },
  { value: "Europe/London", label: "UK (London)" },
  { value: "UTC", label: "UTC" },
];

export function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    // Throws RangeError for unknown zones.
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export type LocationDetailsPatch = Partial<{
  name: string;
  businessName: string | null;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  timezone: string;
  logoUrl: string | null;
  bookingNote: string | null;
  passAccessUrl: string | null;
  disabled: boolean;
}>;

export const LOCATION_DETAILS_SELECT = {
  id: true,
  name: true,
  slug: true,
  disabled: true,
  businessName: true,
  phone: true,
  email: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  zip: true,
  country: true,
  timezone: true,
  logoUrl: true,
  bookingNote: true,
  passAccessUrl: true,
} as const;

function cleanNullable(v: unknown, max = 200): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Validate + normalize a details patch. Throws Error with a user-facing
 * message on invalid input. Returns only the keys that were supplied.
 */
export function sanitizeLocationDetails(input: Record<string, unknown>): LocationDetailsPatch {
  const out: LocationDetailsPatch = {};
  if (input.name !== undefined) {
    const nm = String(input.name ?? "").trim();
    if (!nm) throw new Error("Name cannot be empty");
    out.name = nm.slice(0, 120);
  }
  for (const k of ["businessName", "addressLine1", "addressLine2", "city", "state", "zip"] as const) {
    if (input[k] !== undefined) out[k] = cleanNullable(input[k]);
  }
  if (input.country !== undefined) {
    const c = cleanNullable(input.country, 2);
    out.country = c ? c.toUpperCase() : null;
  }
  if (input.phone !== undefined) {
    const p = cleanNullable(input.phone, 32);
    if (p && p.replace(/\D/g, "").length < 7) throw new Error("Phone number looks too short");
    out.phone = p;
  }
  if (input.email !== undefined) {
    const e = cleanNullable(input.email, 200)?.toLowerCase() ?? null;
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("Email address is invalid");
    out.email = e;
  }
  if (input.timezone !== undefined) {
    const tz = String(input.timezone ?? "").trim();
    if (!isValidTimezone(tz)) throw new Error(`Unknown timezone "${tz}" — use an IANA name like America/New_York`);
    out.timezone = tz;
  }
  if (input.logoUrl !== undefined) {
    const u = cleanNullable(input.logoUrl, 500);
    if (u && !/^https?:\/\//i.test(u)) throw new Error("Logo URL must start with http:// or https://");
    out.logoUrl = u;
  }
  if (input.passAccessUrl !== undefined) {
    const u = cleanNullable(input.passAccessUrl, 500);
    if (u && !/^https?:\/\//i.test(u)) throw new Error("Pass access URL must start with http:// or https://");
    out.passAccessUrl = u;
  }
  if (input.bookingNote !== undefined) {
    out.bookingNote = input.bookingNote === null ? null : String(input.bookingNote).slice(0, 4000);
  }
  if (input.disabled !== undefined) out.disabled = Boolean(input.disabled);
  return out;
}

export async function updateLocationDetails(slug: string, patch: LocationDetailsPatch) {
  return getPrisma().location.update({ where: { slug }, data: patch, select: LOCATION_DETAILS_SELECT });
}

// ─────────────────────────────────────────────────────────────────────────────
// Organization (parent of locations) — settings row + cheap comms status
// ─────────────────────────────────────────────────────────────────────────────

export const ORG_SETTINGS_SELECT = {
  id: true,
  name: true,
  slug: true,
  brandColor: true,
  logoUrl: true,
  contactEmail: true,
  contactPhone: true,
  defaultTimezone: true,
  emailEnabled: true,
  smsEnabled: true,
  bccEmail: true,
  replyToEmail: true,
  emailFooter: true,
  updatedAt: true,
} as const;

/** v1 has a single Organization row; create it lazily so settings always load. */
export async function getOrCreateOrg() {
  const prisma = getPrisma();
  const existing = await prisma.organization.findFirst({ select: ORG_SETTINGS_SELECT, orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return prisma.organization.create({ data: { name: "Tee24", slug: "tee24" }, select: ORG_SETTINGS_SELECT });
}

export type CommsStatus = { emailEnabled: boolean; smsEnabled: boolean };
let commsCache: { at: number; value: CommsStatus } | null = null;
const COMMS_TTL_MS = 30_000;

/**
 * Email/SMS kill-switch state for the admin shell banner. Cached in-process
 * for 30s so the layout stays cheap; `invalidateCommsStatus()` after a PATCH.
 */
export async function getCommsStatus(): Promise<CommsStatus> {
  if (commsCache && Date.now() - commsCache.at < COMMS_TTL_MS) return commsCache.value;
  try {
    const org = await getPrisma().organization.findFirst({ select: { emailEnabled: true, smsEnabled: true }, orderBy: { createdAt: "asc" } });
    const value = { emailEnabled: org?.emailEnabled ?? true, smsEnabled: org?.smsEnabled ?? true };
    commsCache = { at: Date.now(), value };
    return value;
  } catch {
    return { emailEnabled: true, smsEnabled: true };
  }
}

export function invalidateCommsStatus() {
  commsCache = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE: Full location removal (with safety checks)
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteLocation(slug: string): Promise<void> {
  const location = await getPrisma().location.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!location) throw new Error("Location not found");

  const hasData = await getPrisma().$transaction(async (tx) => {
    const bays = await tx.bay.count({ where: { locationId: location.id } });
    const bookings = await tx.booking.count({ where: { locationId: location.id } });
    return { bays, bookings };
  });

  if (hasData.bays > 0 || hasData.bookings > 0) {
    throw new Error("Cannot delete location with bays or bookings");
  }

  await getPrisma().$transaction(async (tx) => {
    await tx.adminLocation.deleteMany({ where: { locationId: location.id } });
    await tx.bay.deleteMany({ where: { locationId: location.id } });
    await tx.notification.deleteMany({ where: { locationId: location.id } });
    await tx.location.delete({ where: { id: location.id } });
  });
}