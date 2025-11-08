-- prisma/migrations/20251107184501_remove-legacy-template-columns/migration.sql
-- Fix: Remove emailTemplate/smsTemplate, preserve disabled, fix PK name
BEGIN;

-- ==============================================================
-- 0. CLEANUP: Drop any leftover Location_new from failed runs
-- ==============================================================
DROP TABLE IF EXISTS "Location_new" CASCADE;

-- ==============================================================
-- 1. Drop foreign-key constraints
-- ==============================================================
ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS "Booking_locationId_fkey";
ALTER TABLE "Bay" DROP CONSTRAINT IF EXISTS "Bay_locationId_fkey";
ALTER TABLE "AdminLocation" DROP CONSTRAINT IF EXISTS "AdminLocation_locationId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_locationId_fkey";

-- ==============================================================
-- 2. Create new table
-- ==============================================================
CREATE TABLE "Location_new" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "bookingNote" TEXT NOT NULL DEFAULT '',
    "passAccessUrl" TEXT,
    "open24Hours" BOOLEAN NOT NULL DEFAULT false,
    "hours" TEXT NOT NULL DEFAULT '[]',
    "minBookingMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxBookingMinutes" INTEGER NOT NULL DEFAULT 120,
    "maxActiveBookingsPerGuest" INTEGER NOT NULL DEFAULT 2,
    "activeBookingIdentifyBy" TEXT NOT NULL DEFAULT 'either',
    "activeBookingWindowHours" INTEGER NOT NULL DEFAULT 24,
    "maxConsecutiveBookingsPerGuest" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Location_new_pkey" PRIMARY KEY ("id")
);

-- ==============================================================
-- 3. Copy data
-- ==============================================================
INSERT INTO "Location_new" (
    "id", "name", "slug", "disabled",
    "bookingNote", "passAccessUrl",
    "open24Hours", "hours",
    "minBookingMinutes", "maxBookingMinutes",
    "maxActiveBookingsPerGuest", "activeBookingIdentifyBy",
    "activeBookingWindowHours", "maxConsecutiveBookingsPerGuest",
    "createdAt", "updatedAt"
)
SELECT
    "id", "name", "slug",
    COALESCE("disabled", false),
    COALESCE("bookingNote", ''),
    "passAccessUrl",
    COALESCE("open24Hours", false),
    CASE WHEN "hours" IS NULL THEN '[]' ELSE "hours"::TEXT END,
    COALESCE("minBookingMinutes", 60),
    COALESCE("maxBookingMinutes", 120),
    COALESCE("maxActiveBookingsPerGuest", 2),
    COALESCE("activeBookingIdentifyBy", 'either'),
    COALESCE("activeBookingWindowHours", 24),
    COALESCE("maxConsecutiveBookingsPerGuest", 2),
    "createdAt", "updatedAt"
FROM "Location";

-- ==============================================================
-- 4. Swap tables
-- ==============================================================
DROP TABLE "Location";
ALTER TABLE "Location_new" RENAME TO "Location";

-- ==============================================================
-- 5. FIX: Rename primary key constraint (safe, no regclass issues)
-- ==============================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE c.conname = 'Location_new_pkey'
          AND t.relname = 'Location'
    ) THEN
        ALTER TABLE "Location" RENAME CONSTRAINT "Location_new_pkey" TO "Location_pkey";
    END IF;
END $$;

-- ==============================================================
-- 6. Re-create indexes
-- ==============================================================
CREATE UNIQUE INDEX IF NOT EXISTS "Location_slug_key" ON "Location"("slug");
CREATE INDEX IF NOT EXISTS "Location_slug_idx" ON "Location"("slug");

-- ==============================================================
-- 7. Re-add foreign keys
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