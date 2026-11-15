-- Per-location switch for walk-in reservations at the bay kiosk: pressing Play asks how
-- long the player wants and their phone number, and reserves the bay for them (or warns
-- them when someone else has it booked within 30 minutes). Off by default: Play just
-- starts GSPro, as before.
ALTER TABLE "Location" ADD COLUMN "bayAppWalkInBooking" BOOLEAN NOT NULL DEFAULT false;
