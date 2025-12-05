// types/location.ts
import type { BayInfo, BaySummary } from "./bay";

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
  hours: Record<string, any>;

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

/**
 * Public response — safe for booking UI and public pages
 */
export type PublicLocationInfo = Omit<LocationBase, "disabled" | "createdAt" | "updatedAt"> & {
  bayNumbers: number[];
};

export type AdminLocationWithBays = AdminLocationDetails & {
  bays: BayInfo[];
};

/**
 * Full admin details — everything an admin needs
 */
export type AdminLocationDetails = LocationBase & {
  bayNumbers: number[];
  bays: BayInfo[];
};

/**
 * List item — used in sidebars, dropdowns, admin tables
 */
export type LocationListItem = {
  id: string;
  name: string;
  slug: string;
  disabled: boolean;
};

/**
 * Input types
 */
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
  hours?: Record<string, any>;
};