-- prisma/migrations/20251205123000_add_disabled_to_bay/migration.sql
-- Add disabled column to Bay, default false
BEGIN;

-- ==============================================================
-- 0. Clean up any leftover _new table from a failed run
-- ==============================================================
DROP TABLE IF EXISTS "Bay_new" CASCADE;

-- ==============================================================
-- 1. Drop foreign-key constraints that reference Bay (only the one that points TO Location)
-- ==============================================================
ALTER TABLE IF EXISTS "Bay" DROP CONSTRAINT IF EXISTS "Bay_locationId_fkey";

-- ==============================================================
-- 2. Create the new table with the extra column
-- ==============================================================
CREATE TABLE "Bay_new" (
  "id" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "name" TEXT,
  "locationId" TEXT NOT NULL,
  "kind" "BayKind" NOT NULL DEFAULT 'GROUP',
  "handedness" "Handedness",
  "capacity" INTEGER NOT NULL DEFAULT 4,
  -- NEW COLUMN
  "disabled" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "Bay_new_pkey" PRIMARY KEY ("id")
);

-- ==============================================================
-- 3. Copy all existing data (disabled gets the default)
-- ==============================================================
INSERT INTO "Bay_new" (
  "id", "number", "name", "locationId", "kind", "handedness", "capacity", "disabled"
)
SELECT
  "id",
  "number",
  "name",
  "locationId",
  COALESCE("kind", 'GROUP')::"BayKind",
  "handedness",
  COALESCE("capacity", 4),
  false  -- explicit for every row
FROM "Bay";

-- ==============================================================
-- 4. Swap the tables
-- ==============================================================
DROP TABLE "Bay";
ALTER TABLE "Bay_new" RENAME TO "Bay";

-- ==============================================================
-- 5. Fix primary-key constraint name (PostgreSQL only)
-- ==============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.conname = 'Bay_new_pkey'
      AND t.relname = 'Bay'
  ) THEN
    ALTER TABLE "Bay" RENAME CONSTRAINT "Bay_new_pkey" TO "Bay_pkey";
  END IF;
END $$;

-- ==============================================================
-- 6. Re-create indexes
-- ==============================================================
CREATE UNIQUE INDEX IF NOT EXISTS "Bay_locationId_number_key" ON "Bay"("locationId", "number");
CREATE INDEX IF NOT EXISTS "Bay_locationId_idx" ON "Bay"("locationId");

-- ==============================================================
-- 7. Re-add foreign-key constraint
-- ==============================================================
ALTER TABLE "Bay" ADD CONSTRAINT "Bay_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;