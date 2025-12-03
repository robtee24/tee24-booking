// types/availability.ts
export type TimeSlot = {
  start: string; // ISO UTC e.g. "2025-12-10T14:00:00.000Z"
  end: string;   // ISO UTC
  availableCount: number;
};

export type StartTimes = Record<30 | 60 | 90 | 120, string[]>;

export type AvailableBaysResult = {
  availableCount: number;
  freeBayNumbers: number[]; // Sorted ascending for predictable assignment
};

export type AvailabilityResult = {
  startTimes: StartTimes;
  slots?: TimeSlot[];
  freeBaysBySlot?: Record<string, number[]>; // e.g. "2025-12-10T14:00:00Z|60" → [1,3,5]
};

export type AvailabilityRequest = {
  locationSlug: string;
  date: string; // YYYY-MM-DD (interpreted as UTC)
  kind: "SINGLE" | "GROUP";
  hand?: "RH" | "LH";
  includeSlots?: boolean;
  includeFreeBays?: boolean;
};