-- RedefineTables
-- SQLite: Use PRAGMA to allow table recreation
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Create the new table with updated schema
CREATE TABLE "new_Booking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "bayId" TEXT,
    "bayNumber" INTEGER NOT NULL DEFAULT 1,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Booking_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Copy data from old table (only existing columns)
INSERT INTO "new_Booking" ("id", "locationId", "bayId", "start", "end", "createdAt")
SELECT "id", "locationId", "bayId", "start", "end", "createdAt"
FROM "Booking";

-- Drop old table and rename new one
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";

-- Recreate indexes
CREATE INDEX "Booking_locationId_bayNumber_start_idx" ON "Booking"("locationId", "bayNumber", "start");
CREATE INDEX "Booking_locationId_start_end_idx" ON "Booking"("locationId", "start", "end");

-- Re-enable constraints (SQLite only)
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;