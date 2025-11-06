-- RedefineTables
-- SQLite: Use PRAGMA to safely recreate table with FK constraints
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Create new Booking table with managementToken as required
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
    "managementToken" TEXT NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Booking_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Copy all data; existing NULLs in managementToken will cause INSERT to fail (as warned)
INSERT INTO "new_Booking" (
    "id", "locationId", "bayNumber", "start", "end",
    "firstName", "lastName", "phone", "email",
    "managementToken", "canceledAt", "createdAt"
)
SELECT
    "id", "locationId", "bayNumber", "start", "end",
    "firstName", "lastName", "phone", "email",
    "managementToken", "canceledAt", "createdAt"
FROM "Booking";

-- Replace old table
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";

-- Recreate all indexes, including new unique constraint
CREATE UNIQUE INDEX "Booking_managementToken_key" ON "Booking"("managementToken");
CREATE INDEX "Booking_locationId_bayNumber_start_idx" ON "Booking"("locationId", "bayNumber", "start");
CREATE INDEX "Booking_locationId_start_end_idx" ON "Booking"("locationId", "start", "end");
CREATE INDEX "Booking_email_start_idx" ON "Booking"("email", "start");

-- Re-enable constraints
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;