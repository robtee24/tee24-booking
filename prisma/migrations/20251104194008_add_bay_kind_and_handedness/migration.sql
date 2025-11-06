-- RedefineTables
-- Safe for both SQLite and PostgreSQL using transaction
BEGIN;

-- Create ENUM types
CREATE TYPE "BayKind" AS ENUM ('SINGLE', 'GROUP');
CREATE TYPE "Handedness" AS ENUM ('RH', 'LH');

-- Create updated Bay table
CREATE TABLE "new_Bay" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "number" INTEGER NOT NULL,
  "name" TEXT,
  "locationId" TEXT NOT NULL,
  "kind" "BayKind" NOT NULL DEFAULT 'GROUP',
  "handedness" "Handedness",
  "capacity" INTEGER NOT NULL DEFAULT 4,
  CONSTRAINT "Bay_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Copy data
INSERT INTO "new_Bay" ("id", "number", "name", "locationId", "kind", "handedness", "capacity")
SELECT "id", "number", "name", "locationId",
       COALESCE("kind", 'GROUP')::"BayKind",
       "handedness"::"Handedness",
       COALESCE("capacity", 4)
FROM "Bay";

-- Drop old + rename
DROP TABLE "Bay";
ALTER TABLE "new_Bay" RENAME TO "Bay";

-- Recreate indexes
CREATE INDEX "Bay_locationId_idx" ON "Bay"("locationId");
CREATE UNIQUE INDEX "Bay_locationId_number_key" ON "Bay"("locationId", "number");

COMMIT;