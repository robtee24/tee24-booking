// types/admin-booking.ts
import type { Bay } from "./bay";

/**
 * Single booking as returned from the admin API
 */
export type AdminBooking = {
  id: string;
  bayId: string;
  bayNumber: number;
  start: string;     // ISO UTC
  end: string;       // ISO UTC
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  canceledAt?: string | null;
  createdAt: string;
};

/**
 * Optional: enriched version with full bay object
 */
export type AdminBookingWithBay = AdminBooking & {
  bay: Bay;
};

/**
 * Response from /api/admin/bookings/day
 * This is what your page.tsx expects!
 */
export type AdminDayView = {
  timezone: string;                    // e.g. "America/New_York"
  minBookingMinutes: number;
  bookings: AdminBooking[];
  bays: Bay[];
};