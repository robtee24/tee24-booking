import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  bayAppRegistration: { findUnique: vi.fn() },
  bay: { findUnique: vi.fn() },
  booking: { findFirst: vi.fn(), create: vi.fn() },
};
vi.mock("@/lib/db", () => ({ getPrisma: () => db }));

import { BayWalkInError, createWalkIn, getWalkInPlan, walkInDurations, walkInMaxMinutes } from "./bay-walkin.service";

const NOW = new Date("2026-11-15T20:00:20.000Z");
const at = (minutesFromNow: number) => new Date(Date.UTC(2026, 10, 15, 20, 0, 0) + minutesFromNow * 60_000);

type Row = { id: string; firstName: string; lastName: string; start: Date; end: Date; canceledAt?: Date | null };
let bookings: Row[] = [];

type DateCond = { lt?: Date; lte?: Date; gt?: Date };
type Where = { canceledAt?: null; start?: DateCond; end?: DateCond };

/** Just enough of Prisma's `where` for the three queries the service makes. */
function matches(b: Row, where: Where) {
  if (where.canceledAt === null && b.canceledAt) return false;
  for (const field of ["start", "end"] as const) {
    const cond = where[field];
    if (!cond) continue;
    const v = b[field].getTime();
    if (cond.lt && !(v < cond.lt.getTime())) return false;
    if (cond.lte && !(v <= cond.lte.getTime())) return false;
    if (cond.gt && !(v > cond.gt.getTime())) return false;
  }
  return true;
}

function register(location: Partial<{ bayAppWalkInBooking: boolean; maxBookingMinutes: number; timezone: string }> = {}) {
  db.bayAppRegistration.findUnique.mockResolvedValue({
    locationId: "loc1",
    bayNumber: 11,
    location: { timezone: "America/Chicago", bayAppWalkInBooking: true, maxBookingMinutes: 180, ...location },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  bookings = [];
  register();
  db.bay.findUnique.mockResolvedValue({ disabled: false });
  db.booking.findFirst.mockImplementation(async ({ where }: { where: Where }) => {
    const hit = bookings.filter((b) => matches(b, where)).sort((a, b) => a.start.getTime() - b.start.getTime())[0];
    return hit ?? null;
  });
  db.booking.create.mockImplementation(async ({ data }: { data: Row }) => ({ ...data, id: "new1" }));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("walkInDurations", () => {
  it("offers every half hour up to the cap", () => {
    expect(walkInDurations(180)).toEqual([30, 60, 90, 120, 150, 180]);
    expect(walkInDurations(60)).toEqual([30, 60]);
  });
  it("adds the exact gap when a reservation cuts it short of a half-hour step", () => {
    expect(walkInDurations(47)).toEqual([30, 47]);
    expect(walkInDurations(31)).toEqual([30, 31]);
  });
  it("offers a short gap on its own", () => {
    expect(walkInDurations(20)).toEqual([20]);
    expect(walkInDurations(0)).toEqual([]);
  });
});

describe("walkInMaxMinutes", () => {
  it("never exceeds three hours, and honors a shorter location limit", () => {
    expect(walkInMaxMinutes(240)).toBe(180);
    expect(walkInMaxMinutes(120)).toBe(120);
    expect(walkInMaxMinutes(null)).toBe(180);
  });
});

describe("getWalkInPlan", () => {
  it("launches without asking when the location has walk-ins switched off", async () => {
    register({ bayAppWalkInBooking: false });
    expect(await getWalkInPlan("dev1", NOW)).toMatchObject({ mode: "launch", reason: "DISABLED" });
    expect(db.booking.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a device that is not registered", async () => {
    db.bayAppRegistration.findUnique.mockResolvedValue(null);
    await expect(getWalkInPlan("nope", NOW)).rejects.toMatchObject({ status: 404, code: "DEVICE_NOT_REGISTERED" });
  });

  it("launches when a reservation is already running on the bay", async () => {
    bookings = [{ id: "cur", firstName: "Chris", lastName: "Brown", start: at(-30), end: at(30) }];
    expect(await getWalkInPlan("dev1", NOW)).toMatchObject({ mode: "launch", reason: "IN_RESERVATION" });
  });

  it("asks for confirmation when someone has the bay within 30 minutes", async () => {
    bookings = [{ id: "nx", firstName: "Chris", lastName: "brown", start: at(30), end: at(150) }];
    const plan = await getWalkInPlan("dev1", NOW);
    expect(plan).toMatchObject({ mode: "confirm", timezone: "America/Chicago", next: { id: "nx", firstName: "Chris", lastInitial: "B", start: at(30).toISOString() } });
  });

  it("offers three hours on an open bay, ending on the minute", async () => {
    const plan = await getWalkInPlan("dev1", NOW);
    if (plan.mode !== "walkin") throw new Error(`expected walkin, got ${plan.mode}`);
    expect(plan.next).toBeNull();
    expect(plan.options.map((o) => o.minutes)).toEqual([30, 60, 90, 120, 150, 180]);
    expect(plan.options[0].end).toBe(at(30).toISOString());
  });

  it("caps the durations at the next reservation", async () => {
    bookings = [{ id: "nx", firstName: "Chris", lastName: "Brown", start: at(105), end: at(165) }];
    const plan = await getWalkInPlan("dev1", NOW);
    if (plan.mode !== "walkin") throw new Error(`expected walkin, got ${plan.mode}`);
    expect(plan.options.map((o) => o.minutes)).toEqual([30, 60, 90, 105]);
    expect(plan.options.at(-1)!.end).toBe(at(105).toISOString());
    expect(plan.next).toMatchObject({ id: "nx" });
  });

  it("ignores canceled reservations and ones more than three hours out", async () => {
    bookings = [
      { id: "gone", firstName: "A", lastName: "B", start: at(10), end: at(70), canceledAt: at(-5) },
      { id: "late", firstName: "C", lastName: "D", start: at(200), end: at(260) },
    ];
    const plan = await getWalkInPlan("dev1", NOW);
    if (plan.mode !== "walkin") throw new Error(`expected walkin, got ${plan.mode}`);
    expect(plan.next).toBeNull();
    expect(plan.options).toHaveLength(6);
  });
});

describe("createWalkIn", () => {
  it("reserves the bay from now under the phone number, checked in, with no name or email", async () => {
    const r = await createWalkIn({ deviceId: "dev1", minutes: 90, phone: "(931) 555-0142" }, NOW);
    const { data } = db.booking.create.mock.calls[0][0];
    expect(data).toMatchObject({ locationId: "loc1", bayNumber: 11, firstName: "Walk-in", lastName: "", email: "", phone: "+19315550142", checkedInAt: NOW });
    expect(data.start).toEqual(at(0));
    expect(data.end).toEqual(at(90));
    expect(data.managementToken).toMatch(/^[0-9a-f]{32}$/);
    expect(r.booking).toMatchObject({ id: "new1", firstName: "Walk-in", lastInitial: "", end: at(90).toISOString() });
  });

  it("refuses a bad phone number or duration before touching the database", async () => {
    await expect(createWalkIn({ deviceId: "dev1", minutes: 60, phone: "555" }, NOW)).rejects.toMatchObject({ status: 400, code: "INVALID_PHONE" });
    await expect(createWalkIn({ deviceId: "dev1", minutes: 0, phone: "9315550142" }, NOW)).rejects.toMatchObject({ status: 400, code: "INVALID_DURATION" });
    await expect(createWalkIn({ deviceId: "dev1", minutes: 240, phone: "9315550142" }, NOW)).rejects.toMatchObject({ status: 400, code: "INVALID_DURATION" });
    expect(db.booking.create).not.toHaveBeenCalled();
  });

  it("refuses when walk-ins are off, a reservation is running, or one starts within 30 minutes", async () => {
    register({ bayAppWalkInBooking: false });
    await expect(createWalkIn({ deviceId: "dev1", minutes: 60, phone: "9315550142" }, NOW)).rejects.toMatchObject({ status: 409, code: "WALK_IN_OFF" });

    register();
    bookings = [{ id: "cur", firstName: "Chris", lastName: "Brown", start: at(-30), end: at(30) }];
    await expect(createWalkIn({ deviceId: "dev1", minutes: 60, phone: "9315550142" }, NOW)).rejects.toMatchObject({ status: 409, code: "IN_RESERVATION" });

    bookings = [{ id: "nx", firstName: "Chris", lastName: "Brown", start: at(20), end: at(80) }];
    await expect(createWalkIn({ deviceId: "dev1", minutes: 60, phone: "9315550142" }, NOW)).rejects.toBeInstanceOf(BayWalkInError);
    await expect(createWalkIn({ deviceId: "dev1", minutes: 60, phone: "9315550142" }, NOW)).rejects.toMatchObject({ status: 409, code: "RESERVATION_SOON" });
    expect(db.booking.create).not.toHaveBeenCalled();
  });

  it("stops at the next reservation even if the kiosk asked for longer", async () => {
    bookings = [{ id: "nx", firstName: "Chris", lastName: "Brown", start: at(105), end: at(165) }];
    await createWalkIn({ deviceId: "dev1", minutes: 180, phone: "9315550142" }, NOW);
    expect(db.booking.create.mock.calls[0][0].data.end).toEqual(at(105));
  });
});
