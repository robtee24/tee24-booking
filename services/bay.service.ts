// services/bay.service.ts
import { getPrisma } from "@/lib/db";
import { startOfDay, endOfDay } from "date-fns";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type BayInfo = {
  id: string;
  number: number;
  name: string | null;
  kind: "SINGLE" | "GROUP";
  handedness: "RH" | "LH" | null;
  capacity: number;
};

export type CreateBayInput = {
  number: number;
  name?: string | null;
  kind: "SINGLE" | "GROUP";
  handedness?: "RH" | "LH" | null;
  capacity?: number;
};

export type UpdateBayInput = Partial<CreateBayInput> & { bayId: string };

export type BayScheduleBooking = {
  id: string;
  start: string; // ISO
  end: string;   // ISO
  firstName: string | null;
  lastName: string | null;
};

export type BaySchedule = {
  bay: {
    id: string;
    number: number;
    name: string | null;
  };
  dateISO: string; // YYYY-MM-DD in America/New_York
  bookings: BayScheduleBooking[];
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE bay (admin)
// ─────────────────────────────────────────────────────────────────────────────
export async function createBay(
  locationId: string,
  input: CreateBayInput
): Promise<BayInfo> {
  const { number, name, kind, handedness, capacity } = input;

  if (number <= 0 || !Number.isInteger(number)) {
    throw new Error("Bay number must be a positive integer");
  }

  // Name: allow null or digits only
  if (name !== undefined && name !== null && name !== "" && !/^\d+$/.test(name.trim())) {
    throw new Error("Bay name must contain only digits (0–9) or be empty");
  }
  const cleanName = name === null || name === "" ? null : name.trim();

  // Validate + enforce business rules
  let finalKind: "SINGLE" | "GROUP" = kind;
  let finalHandedness: "RH" | "LH" | null = null;
  let finalCapacity: number;

  if (finalKind === "SINGLE") {
    if (!handedness || !["RH", "LH"].includes(handedness)) {
      throw new Error("Handedness (RH or LH) is required for SINGLE bays");
    }
    finalHandedness = handedness;
    finalCapacity = 1;
  } else {
    // GROUP
    finalHandedness = null;
    finalCapacity = capacity && capacity >= 2 ? capacity : 4;
  }

  return await getPrisma().$transaction(async (tx) => {
    // Prevent duplicate bay number in same location
    const exists = await tx.bay.findFirst({
      where: { locationId, number },
    });
    if (exists) {
      throw new Error(`Bay number ${number} already exists in this location`);
    }

    const bay = await tx.bay.create({
      data: {
        locationId,
        number,
        name: cleanName,
        kind: finalKind,
        handedness: finalHandedness,
        capacity: finalCapacity,
      },
      select: {
        id: true,
        number: true,
        name: true,
        kind: true,
        handedness: true,
        capacity: true,
      },
    });

    return bay;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE bay (admin)
// ─────────────────────────────────────────────────────────────────────────────
export async function updateBay(
  locationId: string,
  { bayId, ...input }: UpdateBayInput
): Promise<BayInfo> {
  const existing = await getPrisma().bay.findFirst({
    where: { id: bayId, locationId },
    select: { id: true, number: true, kind: true, handedness: true, capacity: true, name: true },
  });

  if (!existing) throw new Error("Bay not found");

  const data: any = {};

  // number
  if (input.number !== undefined) {
    if (!Number.isInteger(input.number) || input.number <= 0) {
      throw new Error("Bay number must be a positive integer");
    }
    if (input.number !== existing.number) {
      const conflict = await getPrisma().bay.findFirst({
        where: { locationId, number: input.number },
      });
      if (conflict) throw new Error(`Bay number ${input.number} already exists`);
    }
    data.number = input.number;
  }

  // name
  if (input.name !== undefined) {
    if (input.name === null || input.name === "") {
      data.name = null;
    } else if (typeof input.name === "string" && /^\d+$/.test(input.name.trim())) {
      data.name = input.name.trim();
    } else {
      throw new Error("Bay name must contain only digits or be empty");
    }
  }

  // kind + handedness + capacity rules
  const nextKind = (input.kind ?? existing.kind) as "SINGLE" | "GROUP";

  if (nextKind === "SINGLE") {
    const h = input.handedness ?? existing.handedness;
    if (!h || !["RH", "LH"].includes(h as string)) {
      throw new Error("Handedness (RH or LH) is required for SINGLE bays");
    }
    data.kind = "SINGLE";
    data.handedness = h;
    data.capacity = 1;
  } else {
    data.kind = "GROUP";
    data.handedness = null;
    const cap = input.capacity ?? existing.capacity ?? 4;
    data.capacity = cap >= 2 ? cap : 4;
  }

  if (Object.keys(data).length === 0) {
    throw new Error("No fields to update");
  }

  const updated = await getPrisma().bay.update({
    where: { id: bayId },
    data,
    select: {
      id: true,
      number: true,
      name: true,
      kind: true,
      handedness: true,
      capacity: true,
    },
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE bay (admin) — blocks if future bookings exist
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteBay(locationId: string, bayId: string): Promise<void> {
  const bay = await getPrisma().bay.findFirst({
    where: { id: bayId, locationId },
    select: { id: true, number: true },
  });

  if (!bay) throw new Error("Bay not found");

  const now = new Date();
  const futureBookings = await getPrisma().booking.count({
    where: {
      locationId,
      bayNumber: bay.number,
      start: { gte: now },
      canceledAt: null,
    },
  });

  if (futureBookings > 0) {
    throw new Error(
      `Cannot delete bay: ${futureBookings} future booking(s) exist. Cancel or move them first.`
    );
  }

  await getPrisma().bay.delete({ where: { id: bay.id } });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET: All bays for a location (admin view)
// ─────────────────────────────────────────────────────────────────────────────
export async function getBaysByLocationId(locationId: string): Promise<BayInfo[]> {
  return await getPrisma().bay.findMany({
    where: { locationId },
    orderBy: { number: "asc" },
    select: {
      id: true,
      number: true,
      name: true,
      kind: true,
      handedness: true,
      capacity: true,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW: Public bay schedule for a specific day
// ─────────────────────────────────────────────────────────────────────────────
export async function getBaySchedule(
  bayId: string,
  dateISO?: string // YYYY-MM-DD in America/New_York, defaults to today
): Promise<BaySchedule> {
  const todayNY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const targetDate = dateISO && /^\d{4}-\d{2}-\d{2}$/.test(dateISO) ? dateISO : todayNY;

  const start = startOfDay(new Date(`${targetDate}T00:00:00-05:00`));
  const end = endOfDay(new Date(`${targetDate}T23:59:59-05:00`));

  const bay = await getPrisma().bay.findUnique({
    where: { id: bayId },
    select: {
      id: true,
      number: true,
      name: true,
      locationId: true,
    },
  });

  if (!bay) throw new Error("Bay not found");

  const bookings = await getPrisma().booking.findMany({
    where: {
      locationId: bay.locationId,
      bayNumber: bay.number,
      canceledAt: null,
      start: { lt: end },
      end: { gt: start },
    },
    orderBy: { start: "asc" },
    select: {
      id: true,
      start: true,
      end: true,
      firstName: true,
      lastName: true,
    },
  });

  return {
    bay: {
      id: bay.id,
      number: bay.number,
      name: bay.name,
    },
    dateISO: targetDate,
    bookings: bookings.map((b) => ({
      id: b.id,
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      firstName: b.firstName,
      lastName: b.lastName,
    })),
  };
}