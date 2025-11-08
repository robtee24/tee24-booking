-- prisma/migrations/20251108124500_remove_notificationlog_composite_unique/migration.sql
-- Combined: 
-- 1. Remove composite unique on NotificationLog
-- 2. Convert Notification.channel → TEXT (preserve EMAIL/TEXT)
-- 3. Convert Notification.kind → TEXT (preserve CONFIRMATION/NOTIFICATION)
-- 4. Deduplicate Notification by full unique key
-- 5. Drop both enums
BEGIN;

-- ==============================================================
-- 0. CLEANUP: Drop any leftover temp tables
-- ==============================================================
DROP TABLE IF EXISTS "NotificationLog_new" CASCADE;
DROP TABLE IF EXISTS "Notification_new" CASCADE;

-- ==============================================================
-- 1. NOTIFICATION LOG: Convert channel → TEXT + Preserve values
-- ==============================================================
CREATE TABLE "NotificationLog_new" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "channel" TEXT NOT NULL CHECK ("channel" IN ('EMAIL', 'TEXT')),
  "status" TEXT NOT NULL,
  "providerId" TEXT,
  "error" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationLog_new_pkey" PRIMARY KEY ("id")
);

-- Safely convert enum → TEXT
WITH safe_channel AS (
  SELECT
    "id",
    "bookingId",
    "notificationId",
    "status",
    "providerId",
    "error",
    "sentAt",
    "channel"::TEXT AS safe_channel
  FROM "NotificationLog"
)
INSERT INTO "NotificationLog_new" (
  "id", "bookingId", "notificationId", "channel", "status", "providerId", "error", "sentAt"
)
SELECT
  "id", "bookingId", "notificationId", safe_channel, "status", "providerId", "error", "sentAt"
FROM safe_channel;

DROP TABLE "NotificationLog";
ALTER TABLE "NotificationLog_new" RENAME TO "NotificationLog";

-- Rename PK
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.conname = 'NotificationLog_new_pkey' AND t.relname = 'NotificationLog'
  ) THEN
    ALTER TABLE "NotificationLog" RENAME CONSTRAINT "NotificationLog_new_pkey" TO "NotificationLog_pkey";
  END IF;
END $$;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS "NotificationLog_bookingId_idx" ON "NotificationLog"("bookingId");
CREATE INDEX IF NOT EXISTS "NotificationLog_notificationId_idx" ON "NotificationLog"("notificationId");
CREATE INDEX IF NOT EXISTS "NotificationLog_channel_idx" ON "NotificationLog"("channel");
CREATE INDEX IF NOT EXISTS "NotificationLog_bookingId_notificationId_channel_idx"
  ON "NotificationLog"("bookingId", "notificationId", "channel");

-- ==============================================================
-- 2. NOTIFICATION: Convert kind + channel → TEXT + Deduplicate + Preserve values
-- ==============================================================
CREATE TABLE "Notification_new" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'NOTIFICATION' CHECK ("kind" IN ('CONFIRMATION', 'NOTIFICATION')),
  "channel" TEXT NOT NULL DEFAULT 'EMAIL' CHECK ("channel" IN ('EMAIL', 'TEXT')),
  "hoursBefore" INTEGER NOT NULL DEFAULT 0,
  "template" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_new_pkey" PRIMARY KEY ("id")
);

-- Deduplicate by full unique key (locationId, kind, channel, hoursBefore)
WITH ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY "locationId", "kind"::TEXT, "channel"::TEXT, "hoursBefore"
      ORDER BY "updatedAt" DESC
    ) AS rn,
    "kind"::TEXT AS safe_kind,
    "channel"::TEXT AS safe_channel
  FROM "Notification"
)
INSERT INTO "Notification_new" (
  "id", "locationId", "kind", "channel", "hoursBefore", "template", "enabled", "order", "createdAt", "updatedAt"
)
SELECT
  "id",
  "locationId",
  safe_kind,
  safe_channel,
  COALESCE("hoursBefore", 0),
  COALESCE("template", ''),
  COALESCE("enabled", true),
  COALESCE("order", 0),
  "createdAt",
  "updatedAt"
FROM ranked
WHERE rn = 1;

DROP TABLE "Notification";
ALTER TABLE "Notification_new" RENAME TO "Notification";

-- Rename PK
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.conname = 'Notification_new_pkey' AND t.relname = 'Notification'
  ) THEN
    ALTER TABLE "Notification" RENAME CONSTRAINT "Notification_new_pkey" TO "Notification_pkey";
  END IF;
END $$;

-- Create unique index
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_locationId_kind_channel_hoursBefore_key"
  ON "Notification"("locationId", "kind", "channel", "hoursBefore");

CREATE INDEX IF NOT EXISTS "Notification_locationId_kind_channel_idx"
  ON "Notification"("locationId", "kind", "channel");

-- ==============================================================
-- 3. Drop both enums
-- ==============================================================
DROP TYPE IF EXISTS "NotificationChannel" CASCADE;
DROP TYPE IF EXISTS "NotificationKind" CASCADE;

COMMIT;