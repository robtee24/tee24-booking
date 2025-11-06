-- RedefineTables
-- Safe for both SQLite and PostgreSQL using transaction
BEGIN;

-- Create ENUM types (only in PostgreSQL; safe to run in SQLite — it will error but continue if using raw SQL)
DO $$
BEGIN
   IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BayKind') THEN
      CREATE TYPE "BayKind" AS ENUM ('SINGLE', 'GROUP');
   END IF;
END
$$;

DO $$
BEGIN
   IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Handedness') THEN
      CREATE TYPE "Handedness" AS ENUM ('RH', 'LH');
   END IF;
END
$$;

-- Create new table with ENUM types
CREATE TABLE "new_Bay" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "number" INTEGER NOT NULL,
  "name" TEXT,
  "locationId" TEXT NOT NULL,
  "kind" "BayKind" NOT NULL DEFAULT 'GROUP',
  "handedness" "Handedness",
  "capacity" INTEGER NOT NULL DEFAULT 4,
  CONSTRAINT "Bay_locationId_fkey" 
    FOREIGN KEY ("locationId") REFERENCES "Location" ("id") 
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Copy data from old Bay table
-- Old table has no kind/handedness/capacity → use defaults
INSERT INTO "new_Bay" ("id", "number", "name", "locationId", "kind", "capacity")
SELECT 
  "id", 
  "number", 
  "name", 
  "locationId",
  'GROUP'::"BayKind",  -- default for all existing
  4                    -- default capacity
FROM "Bay";

-- Drop old table and rename
DROP TABLE "Bay";
ALTER TABLE "new_Bay" RENAME TO "Bay";

-- Recreate indexes
CREATE INDEX IF NOT EXISTS "Bay_locationId_idx" ON "Bay"("locationId");
CREATE UNIQUE INDEX IF NOT EXISTS "Bay_locationId_number_key" ON "Bay"("locationId", "number");

COMMIT;