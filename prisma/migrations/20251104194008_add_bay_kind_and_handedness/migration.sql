-- RedefineTables (SQLite-safe pattern)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Create updated Bay table with new kind, handedness, and capacity columns
CREATE TABLE "new_Bay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "locationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'GROUP',
    "handedness" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    CONSTRAINT "Bay_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Copy all existing data
INSERT INTO "new_Bay" ("id", "number", "name", "locationId")
SELECT "id", "number", "name", "locationId"
FROM "Bay";

-- Replace old table
DROP TABLE "Bay";
ALTER TABLE "new_Bay" RENAME TO "Bay";

-- Recreate indexes
CREATE INDEX "Bay_locationId_idx" ON "Bay"("locationId");
CREATE UNIQUE INDEX "Bay_locationId_number_key" ON "Bay"("locationId", "number");

-- Re-enable constraints
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;