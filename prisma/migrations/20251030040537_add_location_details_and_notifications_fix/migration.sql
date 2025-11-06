-- CreateTable
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

-- RedefineTables
-- SQLite: Use PRAGMA to safely recreate Location with FK references
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "bookingNote" TEXT NOT NULL DEFAULT '',
    "emailTemplate" TEXT,
    "smsTemplate" TEXT,
    "open24Hours" BOOLEAN NOT NULL DEFAULT false,
    "hours" TEXT NOT NULL DEFAULT '[]',  -- SQLite has no JSONB; store as TEXT
    "minBookingMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxBookingMinutes" INTEGER NOT NULL DEFAULT 120,
    "maxActiveBookingsPerGuest" INTEGER NOT NULL DEFAULT 2,
    "activeBookingIdentifyBy" TEXT NOT NULL DEFAULT 'either',
    "activeBookingWindowHours" INTEGER NOT NULL DEFAULT 24,
    "maxConsecutiveBookingsPerGuest" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Copy existing data; preserve defaults and convert NULLs safely
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

-- Recreate indexes
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");
CREATE INDEX "Location_slug_idx" ON "Location"("slug");

-- Re-enable constraints
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Create indexes on Notification
CREATE INDEX "Notification_locationId_kind_channel_idx" ON "Notification"("locationId", "kind", "channel");
CREATE UNIQUE INDEX "Notification_locationId_kind_channel_hoursBefore_key" ON "Notification"("locationId", "kind", "channel", "hoursBefore");