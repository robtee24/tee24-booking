-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "bookingNote" TEXT,
    "emailTemplate" TEXT,
    "smsTemplate" TEXT,
    "passAccessUrl" TEXT,
    "open24Hours" BOOLEAN NOT NULL DEFAULT false,
    "hours" JSONB NOT NULL,
    "minBookingMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxBookingMinutes" INTEGER NOT NULL DEFAULT 120,
    "maxActiveBookingsPerGuest" INTEGER NOT NULL DEFAULT 2,
    "activeBookingIdentifyBy" TEXT NOT NULL DEFAULT 'either',
    "activeBookingWindowHours" INTEGER NOT NULL DEFAULT 24,
    "maxConsecutiveBookingsPerGuest" INTEGER NOT NULL DEFAULT 2,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Location" ("activeBookingIdentifyBy", "activeBookingWindowHours", "bookingNote", "createdAt", "disabled", "emailTemplate", "hours", "id", "maxActiveBookingsPerGuest", "maxBookingMinutes", "maxConsecutiveBookingsPerGuest", "minBookingMinutes", "name", "open24Hours", "slug", "smsTemplate", "updatedAt") SELECT "activeBookingIdentifyBy", "activeBookingWindowHours", "bookingNote", "createdAt", "disabled", "emailTemplate", "hours", "id", "maxActiveBookingsPerGuest", "maxBookingMinutes", "maxConsecutiveBookingsPerGuest", "minBookingMinutes", "name", "open24Hours", "slug", "smsTemplate", "updatedAt" FROM "Location";
DROP TABLE "Location";
ALTER TABLE "new_Location" RENAME TO "Location";
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
