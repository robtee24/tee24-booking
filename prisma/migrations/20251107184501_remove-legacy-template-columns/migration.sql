-- Migration: Remove emailTemplate & smsTemplate from Location
-- Works on PostgreSQL and SQLite
-- Uses a temporary table + transaction (required for SQLite)

BEGIN;

-- ==============================================================
-- 1. Drop foreign-key constraints that reference Location
-- ==============================================================
ALTER TABLE "Booking"       DROP CONSTRAINT IF EXISTS "Booking_locationId_fkey";
ALTER TABLE "Bay"           DROP CONSTRAINT IF EXISTS "Bay_locationId_fkey";
ALTER TABLE "AdminLocation" DROP CONSTRAINT IF EXISTS "AdminLocation_locationId_fkey";
ALTER TABLE "Notification"  DROP CONSTRAINT IF EXISTS "Notification_locationId_fkey";

-- ==============================================================
-- 2. Create the new, clean Location table (hours = TEXT)
-- ==============================================================
CREATE TABLE "Location_new" (
    "id"                          TEXT    NOT NULL,
    "name"                        TEXT    NOT NULL,
    "slug"                        TEXT    NOT NULL,
    "bookingNote"                 TEXT,
    "passAccessUrl"               TEXT,
    "open24Hours"                 BOOLEAN,
    "hours"                       TEXT,                     -- ← TEXT, not JSON
    "minBookingMinutes"           INTEGER,
    "maxBookingMinutes"           INTEGER,
    "maxActiveBookingsPerGuest"   INTEGER,
    "activeBookingIdentifyBy"     TEXT,
    "activeBookingWindowHours"    INTEGER,
    "maxConsecutiveBookingsPerGuest" INTEGER,
    "createdAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_new_pkey" PRIMARY KEY ("id")
);

-- ==============================================================
-- 3. Copy data – cast "hours" to TEXT
-- ==============================================================
INSERT INTO "Location_new" (
    "id", "name", "slug", "bookingNote", "passAccessUrl",
    "open24Hours", "hours", "minBookingMinutes", "maxBookingMinutes",
    "maxActiveBookingsPerGuest", "activeBookingIdentifyBy",
    "activeBookingWindowHours", "maxConsecutiveBookingsPerGuest",
    "createdAt", "updatedAt"
)
SELECT
    "id", "name", "slug", "bookingNote", "passAccessUrl",
    "open24Hours",
    "hours"::TEXT,                     -- ← explicit cast for PostgreSQL
    "minBookingMinutes", "maxBookingMinutes",
    "maxActiveBookingsPerGuest", "activeBookingIdentifyBy",
    "activeBookingWindowHours", "maxConsecutiveBookingsPerGuest",
    "createdAt", "updatedAt"
FROM "Location";

-- ==============================================================
-- 4. Swap tables
-- ==============================================================
DROP TABLE "Location";
ALTER TABLE "Location_new" RENAME TO "Location";

-- ==============================================================
-- 5. Re-create the unique slug index
-- ==============================================================
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");

-- ==============================================================
-- 6. Re-add **all** foreign-key constraints
-- ==============================================================
ALTER TABLE "Bay"
  ADD CONSTRAINT "Bay_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdminLocation"
  ADD CONSTRAINT "AdminLocation_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;