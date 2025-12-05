// types/location.ts

import type { BayInfo, BaySummary } from "./bay";

// ─────────────────────────────────────────────────────────────────────────────
// Precise type for location hours
// ─────────────────────────────────────────────────────────────────────────────
export type DayHours = {
  open: string;     // e.g. "09:00"
  close: string;    // e.g. "22:00"
  enabled: boolean;
}[];

export type LocationHours = Partial<Record<
  "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday",
  DayHours
>>;

// If you ever support multiple sessions per day (e.g. lunch break), this scales perfectly.
// Otherwise, you can simplify to just one { open, close, enabled } object per day.

/**
 * Core location fields shared across public/admin
 */
export type LocationBase = {
  id: string;
  name: string;
  slug: string;
  disabled: boolean;
  bookingNote: string;
  passAccessUrl: string | null;
  open24Hours: boolean;
  hours: LocationHours;
  timezone: string;
  minBookingMinutes: number;
  maxBookingMinutes: number;
  maxActiveBookingsPerGuest: number;
  activeBookingIdentifyBy: "email" | "phone" | "either";
  activeBookingWindowHours: number;
  maxConsecutiveBookingsPerGuest: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicLocationInfo = Omit<LocationBase, "disabled" | "createdAt" | "updatedAt"> & {
  bayNumbers: number[];
};

export type AdminLocationDetails = LocationBase & {
  bayNumbers: number[];
  bays: BayInfo[];
};

export type AdminLocationWithBays = AdminLocationDetails & {
  bays: BayInfo[];
};

export type LocationListItem = {
  id: string;
  name: string;
  slug: string;
  disabled: boolean;
};

export type CreateLocationInput = {
  name: string;
  slug: string;
};

export type UpdateLocationDisabledInput = {
  slug: string;
  disabled: boolean;
};

export type UpdateLocationSettingsInput = {
  slug: string;
} & Partial<
  Omit<
    LocationBase,
    "id" | "slug" | "disabled" | "createdAt" | "updatedAt" | "hours"
  >
> & {
  hours?: LocationHours;
};