-- RedefineTables (SQLite-safe pattern)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Create updated Location table with new 'disabled' column
CREATE TABLE "new_Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
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

-- Copy all existing data safely
INSERT INTO "new_Location" (
    "id", "name", "slug",
    "bookingNote", "emailTemplate", "smsTemplate",
    "open24Hours", "hours", "minBookingMinutes", "maxBookingMinutes",
    "maxActiveBookingsPerGuest", "activeBookingIdentifyBy", "activeBookingWindowHours",
    "maxConsecutiveBookingsPerGuest", "createdAt", "updatedAt"
)
SELECT
    "id", "name", "slug",
    COALESCE("bookingNote", ''),
    "emailTemplate", "smsTemplate",
    "open24Hours", "hours", "minBookingMinutes", "maxBookingMinutes",
    "maxActiveBookingsPerGuest", "activeBookingIdentifyBy", "activeBookingWindowHours",
    "maxConsecutiveBookingsPerGuest", "createdAt", "updatedAt"
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