-- prisma/migrations/20251108124500_remove_notificationlog_composite_unique/migration.sql
-- Safe for SQLite + PostgreSQL: Remove composite unique constraint on NotificationLog
BEGIN;

-- ==============================================================
-- 0. CLEANUP: Drop any leftover NotificationLog_new from failed runs
-- ==============================================================
DROP TABLE IF EXISTS "NotificationLog_new" CASCADE;

-- ==============================================================
-- 1. Drop foreign-key constraints (none directly reference NotificationLog)
-- ==============================================================
-- No FKs point to NotificationLog → safe to skip

-- ==============================================================
-- 2. Create new table without composite unique constraint
-- ==============================================================
CREATE TABLE "NotificationLog_new" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "channel" TEXT NOT NULL, -- Still uses enum in PostgreSQL, but no composite unique
  "status" TEXT NOT NULL,
  "providerId" TEXT,
  "error" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationLog_new_pkey" PRIMARY KEY ("id")
);

-- ==============================================================
-- 3. Copy data from old table
-- ==============================================================
INSERT INTO "NotificationLog_new" (
  "id", "bookingId", "notificationId", "channel",
  "status", "providerId", "error", "sentAt"
)
SELECT
  "id", "bookingId", "notificationId", "channel",
  "status", "providerId", "error", "sentAt"
FROM "NotificationLog";

-- ==============================================================
-- 4. Swap tables
-- ==============================================================
DROP TABLE "NotificationLog";
ALTER TABLE "NotificationLog_new" RENAME TO "NotificationLog";

-- ==============================================================
-- 5. FIX: Rename primary key constraint (PostgreSQL-safe)
-- ==============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.conname = 'NotificationLog_new_pkey'
      AND t.relname = 'NotificationLog'
  ) THEN
    ALTER TABLE "NotificationLog" RENAME CONSTRAINT "NotificationLog_new_pkey" TO "NotificationLog_pkey";
  END IF;
END $$;

-- ==============================================================
-- 6. Re-create indexes (preserve performance)
-- ==============================================================
CREATE INDEX IF NOT EXISTS "NotificationLog_bookingId_idx" ON "NotificationLog"("bookingId");
CREATE INDEX IF NOT EXISTS "NotificationLog_notificationId_idx" ON "NotificationLog"("notificationId");
CREATE INDEX IF NOT EXISTS "NotificationLog_channel_idx" ON "NotificationLog"("channel");

-- Optional: Fast lookup for idempotency (non-unique)
CREATE INDEX IF NOT EXISTS "NotificationLog_bookingId_notificationId_channel_idx" 
ON "NotificationLog"("bookingId", "notificationId", "channel");

COMMIT;