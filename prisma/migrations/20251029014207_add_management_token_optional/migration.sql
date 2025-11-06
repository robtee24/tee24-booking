-- AlterTable
-- SQLite: Use temporary table to add columns (ALTER TABLE ADD COLUMN is limited)
-- PostgreSQL: Direct ADD COLUMN works natively

-- For compatibility, we use the safe RedefineTable pattern (SQLite-friendly)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

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
    "canceledAt" TIMESTAMP(3),
    "managementToken" TEXT,
    CONSTRAINT "Booking_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Copy all existing data
INSERT INTO "new_Booking" (
    "id", "locationId", "bayNumber", "start", "end",
    "firstName", "lastName", "phone", "email", "createdAt"
)
SELECT
    "id", "locationId", "bayNumber", "start", "end",
    "firstName", "lastName", "phone", "email", "createdAt"
FROM "Booking";

-- Replace table
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";

-- Recreate all indexes (including new one)
CREATE INDEX "Booking_locationId_bayNumber_start_idx" ON "Booking"("locationId", "bayNumber", "start");
CREATE INDEX "Booking_locationId_start_end_idx" ON "Booking"("locationId", "start", "end");
CREATE INDEX "Booking_email_start_idx" ON "Booking"("email", "start");

-- Re-enable FK constraints
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;