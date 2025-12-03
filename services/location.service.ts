// services/location.service.ts
import { getPrisma } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type LocationListItem = {
  id: string;
  name: string;
  slug: string;
  disabled: boolean;
};

export type PublicLocationInfo = {
  id: string;
  name: string;
  slug: string;
  bookingNote: string;
  minBookingMinutes: number;
  maxBookingMinutes: number | null;
  bayNumbers: number[];
  passAccessUrl: string | null;
  timezone: string;
};

export type BayInfo = {
  number: number;
  kind: "SINGLE" | "GROUP" | null;
  handedness: "RH" | "LH" | null;
  capacity: number | null;
};

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
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });

  return locations.map((l) => ({ ...l, disabled: false }));
}

// ─────────────────────────────────────────────────────────────────────────────
// GET: Public location info by slug
// ─────────────────────────────────────────────────────────────────────────────
export async function getPublicLocationInfo(slug: string): Promise<PublicLocationInfo> {
  const location = await getPrisma().location.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      bookingNote: true,
      minBookingMinutes: true,
      maxBookingMinutes: true,
      passAccessUrl: true,
      timezone: true,
      bays: { select: { number: true }, orderBy: { number: "asc" } },
    },
  });

  if (!location) throw new Error("Location not found");

  return {
    id: location.id,
    name: location.name,
    slug: location.slug,
    bookingNote: location.bookingNote ?? "",
    minBookingMinutes: location.minBookingMinutes ?? 60,
    maxBookingMinutes: location.maxBookingMinutes ?? null,
    bayNumbers: location.bays.map((b) => b.number),
    passAccessUrl: location.passAccessUrl ?? null,
    timezone: location.timezone ?? "America/New_York",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET: All bays for a location (public — used by booking UI)
// ─────────────────────────────────────────────────────────────────────────────
export async function getLocationBays(slug: string): Promise<BayInfo[]> {
  const location = await getPrisma().location.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!location) throw new Error("Location not found");

  const bays = await getPrisma().bay.findMany({
    where: { locationId: location.id },
    select: {
      number: true,
      kind: true,
      handedness: true,
      capacity: true,
    },
    orderBy: { number: "asc" },
  });

  return bays.map((b) => ({
    number: b.number,
    kind: b.kind as "SINGLE" | "GROUP" | null,
    handedness: b.handedness as "RH" | "LH" | null,
    capacity: b.capacity,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// POST: Create new location — DEFAULT TIMEZONE = NEW YORK
// ─────────────────────────────────────────────────────────────────────────────
export async function createLocation({
  name,
  slug,
}: {
  name: string;
  slug: string;
}): Promise<LocationListItem> {
  const cleanName = name.trim();
  const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

  if (!cleanName || !cleanSlug) throw new Error("Invalid name or slug");

  const exists = await getPrisma().location.findUnique({ where: { slug: cleanSlug } });
  if (exists) throw new Error("Slug already exists");

  return await getPrisma().$transaction(async (tx) => {
    const loc = await tx.location.create({
      data: {
        name: cleanName,
        slug: cleanSlug,
        bookingNote: "",
        hours: {},
        timezone: "America/New_York",
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

    return { ...loc, disabled: false };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET: Single location by slug (admin — no auth check here)
// ─────────────────────────────────────────────────────────────────────────────
export async function getAdminLocationBySlug(slug: string): Promise<LocationListItem & { name: string }> {
  const location = await getPrisma().location.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, disabled: true },
  });

  if (!location) throw new Error("Location not found");

  return {
    id: location.id,
    slug: location.slug,
    name: location.name,
    disabled: location.disabled ?? false,
  };
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
}): Promise<LocationListItem & { name: string }> {
  const location = await getPrisma().location.update({
    where: { slug },
    data: { disabled },
    select: { id: true, slug: true, name: true, disabled: true },
  });

  return {
    id: location.id,
    slug: location.slug,
    name: location.name,
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