// services/location.service.ts
import { getPrisma } from "@/lib/db";
import type {
  LocationListItem,
  PublicLocationInfo,
  AdminLocationDetails,
  CreateLocationInput,
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
    hours: location.hours ?? {},
    timezone: location.timezone ?? "America/New_York",
    minBookingMinutes: location.minBookingMinutes ?? 60,
    maxBookingMinutes: location.maxBookingMinutes ?? 120,
    maxActiveBookingsPerGuest: location.maxActiveBookingsPerGuest ?? 2,
    activeBookingIdentifyBy: location.activeBookingIdentifyBy ?? "either",
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

  const {
    disabled,
    createdAt,
    updatedAt,
    bays,
    ...publicFields
  } = data;

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
    // data already contains everything needed
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
        hours: {},
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