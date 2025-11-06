-- RedefineTables
-- Safe for both SQLite and PostgreSQL - explicitly drop ALL FKs referencing Location
BEGIN;

-- Drop ALL foreign key constraints referencing Location
ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS "Booking_locationId_fkey";
ALTER TABLE "Bay" DROP CONSTRAINT IF EXISTS "Bay_locationId_fkey";
ALTER TABLE "AdminLocation" DROP CONSTRAINT IF EXISTS "AdminLocation_locationId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_locationId_fkey";

-- Create new Location table with 'passAccessUrl' column
CREATE TABLE "new_Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "bookingNote" TEXT NOT NULL DEFAULT '',
    "emailTemplate" TEXT,
    "smsTemplate" TEXT,
    "passAccessUrl" TEXT,
    "open24Hours" BOOLEAN NOT NULL DEFAULT false,
    "hours" TEXT NOT NULL DEFAULT '[]',  -- SQLite: JSON as TEXT
    "minBookingMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxBookingMinutes" INTEGER NOT NULL DEFAULT 120,
    "maxActiveBookingsPerGuest" INTEGER NOT NULL DEFAULT 2,
    "activeBookingIdentifyBy" TEXT NOT NULL DEFAULT 'either',
    "activeBookingWindowHours" INTEGER NOT NULL DEFAULT 24,
    "maxConsecutiveBookingsPerGuest" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Copy all existing data safely
INSERT INTO "new_Location" (
    "id", "name", "slug", "disabled",
    "bookingNote", "emailTemplate", "smsTemplate",
    "open24Hours", "hours", "minBookingMinutes", "maxBookingMinutes",
    "maxActiveBookingsPerGuest", "activeBookingIdentifyBy", "activeBookingWindowHours",
    "maxConsecutiveBookingsPerGuest", "createdAt", "updatedAt"
)
SELECT
    "id", "name", "slug", "disabled",
    COALESCE("bookingNote", ''),
    "emailTemplate", "smsTemplate",
    "open24Hours", "hours", "minBookingMinutes", "maxBookingMinutes",
    "maxActiveBookingsPerGuest", "activeBookingIdentifyBy", "activeBookingWindowHours",
    "maxConsecutiveBookingsPerGuest", "createdAt", "updatedAt"
FROM "Location";

-- Replace old table
DROP TABLE "Location";
ALTER TABLE "new_Location" RENAME TO "Location";

-- Re-add ALL foreign key constraints
ALTER TABLE "Bay" ADD CONSTRAINT "Bay_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdminLocation" ADD CONSTRAINT "AdminLocation_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recreate indexes
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");
CREATE INDEX "Location_slug_idx" ON "Location"("slug");

COMMIT;