// services/bay-walkin.service.ts
//
// Walk-in reservations made at the bay kiosk (Play button).
//
// When the location has `bayAppWalkInBooking` on, the kiosk asks this service
// what Play should do before it starts GSPro:
//
//   launch   Nothing to ask: the switch is off, the bay is disabled, or a
//            reservation is already running on this bay.
//   confirm  Someone else has the bay booked within the next 30 minutes. The
//            kiosk shows who and when and asks the player to confirm.
//   walkin   The bay is free. The kiosk asks how long they want and their phone
//            number, then calls createWalkIn to reserve the bay from now.
//
// A walk-in can run at most 3 hours (less if the location's own maximum is
// lower) and never past the next reservation on the bay.
//
// The server clock decides everything; the kiosk's clock is never trusted.

import crypto from "crypto";
import { getPrisma } from "@/lib/db";
import { toE164 } from "@/lib/phone";

/** A reservation starting this soon gets a warning instead of a walk-in booking. */
export const WALK_IN_NOTICE_MINUTES = 30;
export const WALK_IN_STEP_MINUTES = 30;
export const WALK_IN_MAX_MINUTES = 180;
/**
 * Booking requires a name and an email; a walk-in gives only a phone number.
 * Until walk-ins are matched to their member record, the booking carries this
 * placeholder first name and an empty last name and email.
 */
export const WALK_IN_FIRST_NAME = "Walk-in";

export class BayWalkInError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** What the bay PC is allowed to see of a reservation: never contact details. */
export type WalkInBooking = { id: string; firstName: string; lastInitial: string; start: string; end: string };

export type WalkInOption = { minutes: number; end: string };

export type WalkInPlan =
  | { mode: "launch"; reason: "DISABLED" | "BAY_DISABLED" | "IN_RESERVATION"; serverNow: string }
  | { mode: "confirm"; next: WalkInBooking; serverNow: string; timezone: string }
  | { mode: "walkin"; next: WalkInBooking | null; options: WalkInOption[]; maxMinutes: number; serverNow: string; timezone: string };

type BookingRow = { id: string; firstName: string; lastName: string; start: Date; end: Date };

function publicBooking(b: BookingRow): WalkInBooking {
  return {
    id: b.id,
    firstName: b.firstName,
    lastInitial: (b.lastName ?? "").trim().charAt(0).toUpperCase(),
    start: b.start.toISOString(),
    end: b.end.toISOString(),
  };
}

/**
 * Durations a walk-in may pick: every 30 minutes up to `capMinutes`, plus the
 * cap itself when a reservation cuts it short of a half-hour step (a 47-minute
 * gap offers 30 and 47).
 */
export function walkInDurations(capMinutes: number): number[] {
  const cap = Math.floor(capMinutes);
  const out: number[] = [];
  for (let m = WALK_IN_STEP_MINUTES; m <= cap; m += WALK_IN_STEP_MINUTES) out.push(m);
  if (cap > 0 && cap % WALK_IN_STEP_MINUTES !== 0) out.push(cap);
  return out;
}

/** The location's own maximum when it is shorter than 3 hours, otherwise 3 hours. */
export function walkInMaxMinutes(locationMaxMinutes: number | null | undefined): number {
  const own = locationMaxMinutes && locationMaxMinutes > 0 ? locationMaxMinutes : WALK_IN_MAX_MINUTES;
  return Math.min(own, WALK_IN_MAX_MINUTES);
}

async function registrationFor(deviceId: string) {
  const reg = await getPrisma().bayAppRegistration.findUnique({
    where: { deviceId },
    select: {
      locationId: true,
      bayNumber: true,
      location: { select: { timezone: true, bayAppWalkInBooking: true, maxBookingMinutes: true } },
    },
  });
  if (!reg) throw new BayWalkInError(404, "DEVICE_NOT_REGISTERED", "Device not registered");
  return reg;
}

type Registration = Awaited<ReturnType<typeof registrationFor>>;

async function planFor(reg: Registration, now: Date): Promise<WalkInPlan> {
  const prisma = getPrisma();
  const serverNow = now.toISOString();
  const { locationId, bayNumber, location } = reg;
  const timezone = location.timezone || "America/New_York";

  if (!location.bayAppWalkInBooking) return { mode: "launch", reason: "DISABLED", serverNow };

  const maxMinutes = walkInMaxMinutes(location.maxBookingMinutes);
  // Walk-ins start on the minute, so the end times shown to the player are round.
  const start = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const horizon = new Date(start.getTime() + maxMinutes * 60_000);
  const select = { id: true, firstName: true, lastName: true, start: true, end: true } as const;

  const [bay, current, next] = await Promise.all([
    prisma.bay.findUnique({ where: { locationId_number: { locationId, number: bayNumber } }, select: { disabled: true } }),
    prisma.booking.findFirst({ where: { locationId, bayNumber, canceledAt: null, start: { lte: now }, end: { gt: now } }, select: { id: true } }),
    prisma.booking.findFirst({
      where: { locationId, bayNumber, canceledAt: null, start: { gt: now, lt: horizon } },
      select,
      orderBy: { start: "asc" },
    }),
  ]);

  if (bay?.disabled) return { mode: "launch", reason: "BAY_DISABLED", serverNow };
  if (current) return { mode: "launch", reason: "IN_RESERVATION", serverNow };

  if (next && next.start.getTime() - now.getTime() <= WALK_IN_NOTICE_MINUTES * 60_000) {
    return { mode: "confirm", next: publicBooking(next), serverNow, timezone };
  }

  const gapMinutes = next ? Math.floor((next.start.getTime() - start.getTime()) / 60_000) : maxMinutes;
  const options = walkInDurations(Math.min(maxMinutes, gapMinutes)).map((minutes) => ({
    minutes,
    end: new Date(start.getTime() + minutes * 60_000).toISOString(),
  }));
  return { mode: "walkin", next: next ? publicBooking(next) : null, options, maxMinutes, serverNow, timezone };
}

/** What should Play do on this bay right now? */
export async function getWalkInPlan(deviceId: string, now = new Date()): Promise<WalkInPlan> {
  return planFor(await registrationFor(deviceId), now);
}

/**
 * Reserve this bay from now for a walk-in who gave only a phone number.
 * The booking is created already checked in (they are standing at the bay),
 * so the kiosk does not ask them to unlock their own reservation.
 */
export async function createWalkIn(input: { deviceId: string; minutes: number; phone: string }, now = new Date()) {
  const minutes = Math.floor(Number(input.minutes));
  if (!Number.isFinite(minutes) || minutes < 1) throw new BayWalkInError(400, "INVALID_DURATION", "Choose how long you would like to play.");

  let phone: string;
  try {
    phone = toE164(input.phone);
  } catch {
    throw new BayWalkInError(400, "INVALID_PHONE", "Enter a 10-digit phone number.");
  }

  const reg = await registrationFor(input.deviceId);
  const plan = await planFor(reg, now);
  if (plan.mode === "launch") {
    if (plan.reason === "IN_RESERVATION") throw new BayWalkInError(409, "IN_RESERVATION", "This bay already has a reservation running.");
    throw new BayWalkInError(409, "WALK_IN_OFF", "Walk-in reservations are turned off for this bay.");
  }
  if (plan.mode === "confirm") {
    throw new BayWalkInError(409, "RESERVATION_SOON", `${plan.next.firstName} ${plan.next.lastInitial}. has this bay booked within ${WALK_IN_NOTICE_MINUTES} minutes.`);
  }
  if (minutes > plan.maxMinutes) throw new BayWalkInError(400, "INVALID_DURATION", `The longest walk-in is ${plan.maxMinutes} minutes.`);

  const start = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  let end = new Date(start.getTime() + minutes * 60_000);
  // The kiosk fetched its options a minute or two ago; never run into the next reservation.
  if (plan.next && end.getTime() > new Date(plan.next.start).getTime()) end = new Date(plan.next.start);

  const prisma = getPrisma();
  const { locationId, bayNumber } = reg;
  // Same defense-in-depth overlap check createBooking does, right before the insert.
  const conflict = await prisma.booking.findFirst({
    where: { locationId, bayNumber, canceledAt: null, start: { lt: end }, end: { gt: start } },
    select: { id: true },
  });
  if (conflict) throw new BayWalkInError(409, "BAY_TAKEN", "This bay was just reserved by someone else.");

  const booking = await prisma.booking.create({
    data: {
      locationId,
      bayNumber,
      start,
      end,
      firstName: WALK_IN_FIRST_NAME,
      lastName: "",
      email: "",
      phone,
      managementToken: crypto.randomBytes(16).toString("hex"),
      checkedInAt: now,
    },
    select: { id: true, firstName: true, lastName: true, start: true, end: true },
  });
  console.log(`[bay-walkin] booking ${booking.id}: bay ${bayNumber}, ${minutes} min (device ${input.deviceId})`);
  return { booking: { ...publicBooking(booking), checkedInAt: now.toISOString() }, serverNow: now.toISOString() };
}
