-- RedefineTables
-- Safe for both SQLite and PostgreSQL - explicitly manage FKs referencing Location
BEGIN;

-- Drop all foreign key constraints referencing Location
ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS "Booking_locationId_fkey";
ALTER TABLE "Bay" DROP CONSTRAINT IF EXISTS "Bay_locationId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_locationId_fkey";

-- Create updated Location table with new settings
CREATE TABLE "new_Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "bookingNote" TEXT NOT NULL DEFAULT '',
    "emailTemplate" TEXT,
    "smsTemplate" TEXT,
    "open24Hours" BOOLEAN NOT NULL DEFAULT false,
    "hours" TEXT NOT NULL DEFAULT '[]',  -- SQLite: JSON stored as TEXT
    "minBookingMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxBookingMinutes" INTEGER NOT NULL DEFAULT 120,
    "maxActiveBookingsPerGuest" INTEGER NOT NULL DEFAULT 2,
    "activeBookingIdentifyBy" TEXT NOT NULL DEFAULT 'either',
    "activeBookingWindowHours" INTEGER NOT NULL DEFAULT 24,
    "maxConsecutiveBookingsPerGuest" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Copy existing data safely
INSERT INTO "new_Location" (
    "id", "name", "slug", "bookingNote", "emailTemplate", "smsTemplate"
)
SELECT
    "id", "name", "slug",
    COALESCE("bookingNote", ''),
    "emailTemplate", "smsTemplate"
FROM "Location";

-- Replace old table
DROP TABLE "Location";
ALTER TABLE "new_Location" RENAME TO "Location";

-- Re-add foreign key constraints
ALTER TABLE "Bay" ADD CONSTRAINT "Bay_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recreate indexes on Location
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");
CREATE INDEX "Location_slug_idx" ON "Location"("slug");

COMMIT;

-- Create Notification table and its indexes (outside transaction for safety)
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "hoursBefore" INTEGER NOT NULL DEFAULT 0,
    "template" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Notification_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Notification_locationId_kind_channel_idx" ON "Notification"("locationId", "kind", "channel");
CREATE UNIQUE INDEX "Notification_locationId_kind_channel_hoursBefore_key" ON "Notification"("locationId", "kind", "channel", "hoursBefore");