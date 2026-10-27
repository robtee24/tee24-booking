-- Booking settings: simultaneous-play cap, duration step, and product defaults.
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "maxSimultaneousBookings" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "bookingDurationStepMinutes" INTEGER NOT NULL DEFAULT 60;

UPDATE "Location" SET
  "maxActiveBookingsPerGuest" = 3,
  "maxBookingMinutes" = 180,
  "maxConsecutiveBookingsPerGuest" = 2,
  "maxSimultaneousBookings" = 1,
  "bookingDurationStepMinutes" = 60,
  "minBookingMinutes" = 60;
