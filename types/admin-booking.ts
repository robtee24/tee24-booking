// types/admin-booking.ts

export type Bay = {
  id: string;
  number: number;
};

export type AdminBooking = {
  id: string;
  bayId: string | null;
  bayNumber: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  start: string; // ISO UTC
  end: string;   // ISO UTC
};

export type AdminDayView = {
  date: string; // YYYY-MM-DD
  locationId: string;
  locationName: string;
  timezone: string;
  minBookingMinutes: number;
  bays: Bay[];
  bookings: AdminBooking[];
};