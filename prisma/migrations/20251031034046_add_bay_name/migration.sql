-- RedefineTables
-- Safe for both SQLite and PostgreSQL using transaction
BEGIN;

-- Create new Bay table with added 'name' column (nullable)
CREATE TABLE "new_Bay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT,
    CONSTRAINT "Bay_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Copy all existing data
INSERT INTO "new_Bay" ("id", "number", "locationId")
SELECT "id", "number", "locationId"
FROM "Bay";

-- Replace old table
DROP TABLE "Bay";
ALTER TABLE "new_Bay" RENAME TO "Bay";

-- Recreate indexes
CREATE INDEX "Bay_locationId_idx" ON "Bay"("locationId");
CREATE UNIQUE INDEX "Bay_locationId_number_key" ON "Bay"("locationId", "number");

COMMIT;