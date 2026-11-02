import { describe, expect, it } from "vitest";
import { ageAt, buildWeeks, mondayOf, sundayDeadline } from "./schedule";

const TZ = "America/New_York";
const inTz = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d).replace(",", "");

describe("mondayOf / sundayDeadline", () => {
  it("snaps to Monday 00:00 local and Sunday 23:59:59 local", () => {
    const wed = new Date("2026-11-04T17:00:00Z"); // Wed Nov 4 2026, noon ET
    const mon = mondayOf(wed, TZ);
    expect(inTz(mon)).toMatch(/^Mon (00|24):00:00$/);
    const sun = sundayDeadline(mon, TZ);
    expect(inTz(sun)).toBe("Sun 23:59:59");
    expect(sun.getTime() - mon.getTime()).toBeGreaterThan(6 * 86400_000);
  });
});

describe("buildWeeks", () => {
  it("builds consecutive Monday→Sunday weeks; the last is the championship week when asked", () => {
    const start = new Date("2026-11-09T12:00:00Z");
    const weeks = buildWeeks(start, 4, TZ, true);
    expect(weeks).toHaveLength(4);
    expect(weeks.map((w) => w.weekNumber)).toEqual([1, 2, 3, 4]);
    expect(weeks[3]!.isChampionship).toBe(true);
    expect(weeks[2]!.isChampionship).toBe(false);
    expect(buildWeeks(start, 4, TZ).every((w) => !w.isChampionship)).toBe(true);
    for (let i = 1; i < weeks.length; i++) {
      // Each week opens right after the previous deadline.
      expect(weeks[i]!.opensAt.getTime() - weeks[i - 1]!.deadlineAt.getTime()).toBe(1000);
    }
    // Survives the DST change (Nov 1 2026 is already past; March 2027 crossing checked separately).
    const spring = buildWeeks(new Date("2027-03-08T12:00:00Z"), 2, TZ);
    expect(inTz(spring[0]!.opensAt)).toMatch(/^Mon (00|24):00:00$/);
    expect(inTz(spring[1]!.deadlineAt)).toBe("Sun 23:59:59");
  });
});

describe("ageAt", () => {
  it("computes whole years", () => {
    expect(ageAt(new Date("2010-06-15"), new Date("2026-06-14"))).toBe(15);
    expect(ageAt(new Date("2010-06-15"), new Date("2026-06-15"))).toBe(16);
    expect(ageAt(new Date("2008-01-01"), new Date("2026-10-30"))).toBe(18);
  });
});
