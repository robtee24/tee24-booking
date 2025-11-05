/*
  Warnings:

  - You are about to drop the column `bayId` on the `Booking` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Booking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "bayNumber" INTEGER NOT NULL,
    "start" DATETIME NOT NULL,
    "end" DATETIME NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Booking_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Booking" ("bayNumber", "createdAt", "email", "end", "firstName", "id", "lastName", "locationId", "phone", "start") SELECT "bayNumber", "createdAt", "email", "end", "firstName", "id", "lastName", "locationId", "phone", "start" FROM "Booking";
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";
CREATE INDEX "Booking_locationId_bayNumber_start_idx" ON "Booking"("locationId", "bayNumber", "start");
CREATE INDEX "Booking_locationId_start_end_idx" ON "Booking"("locationId", "start", "end");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
