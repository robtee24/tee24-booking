-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
INSERT INTO "new_Bay" ("id", "locationId", "name", "number") SELECT "id", "locationId", "name", "number" FROM "Bay";
DROP TABLE "Bay";
ALTER TABLE "new_Bay" RENAME TO "Bay";
CREATE INDEX "Bay_locationId_idx" ON "Bay"("locationId");
CREATE UNIQUE INDEX "Bay_locationId_number_key" ON "Bay"("locationId", "number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
