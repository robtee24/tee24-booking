-- RedefineTables
-- Safe for both SQLite and PostgreSQL - explicitly drop/re-add FKs referencing Location
BEGIN;

-- Drop all foreign key constraints referencing Location (must come first)
ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS "Booking_locationId_fkey";
ALTER TABLE "Bay" DROP CONSTRAINT IF EXISTS "Bay_locationId_fkey";

-- Create new Location table with optional template columns
CREATE TABLE "new_Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "bookingNote" TEXT NOT NULL DEFAULT '',
    "emailTemplate" TEXT,
    "smsTemplate" TEXT
);

-- Copy existing data safely
INSERT INTO "new_Location" ("id", "name", "slug", "bookingNote")
SELECT "id", "name", "slug", COALESCE("bookingNote", '')
FROM "Location";

-- Replace old table
DROP TABLE "Location";
ALTER TABLE "new_Location" RENAME TO "Location";

-- Re-add foreign key constraints
ALTER TABLE "Bay" ADD CONSTRAINT "Bay_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Recreate indexes
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");
CREATE INDEX "Location_slug_idx" ON "Location"("slug");

COMMIT;