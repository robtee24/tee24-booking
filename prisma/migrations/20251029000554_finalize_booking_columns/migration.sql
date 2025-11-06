-- RedefineTables
-- SQLite: Use PRAGMA to allow table recreation with FK constraints
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Create new Booking table without bayId (column will be dropped)
CREATE TABLE "new_Booking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "bayNumber" INTEGER NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Booking_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Copy data from existing columns (bayId is intentionally excluded)
INSERT INTO "new_Booking" (
    "id", "locationId", "bayNumber", "start", "end",
    "firstName", "lastName", "phone", "email", "createdAt"
)
SELECT
    "id", "locationId", "bayNumber", "start", "end",
    "firstName", "lastName", "phone", "email", "createdAt"
FROM "Booking";

-- Drop old table and rename
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";

-- Recreate indexes
CREATE INDEX "Booking_locationId_bayNumber_start_idx" ON "Booking"("locationId", "bayNumber", "start");
CREATE INDEX "Booking_locationId_start_end_idx" ON "Booking"("locationId", "start", "end");

-- Re-enable constraints (SQLite only)
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;