-- RedefineTables
-- SQLite: Use PRAGMA to allow table recreation with active foreign keys
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Create updated Location table with new 'bookingNote' column
CREATE TABLE "new_Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "bookingNote" TEXT NOT NULL DEFAULT ''
);

-- Copy existing data; new column gets default ''
INSERT INTO "new_Location" ("id", "name", "slug")
SELECT "id", "name", "slug"
FROM "Location";

-- Replace old table
DROP TABLE "Location";
ALTER TABLE "new_Location" RENAME TO "Location";

-- Recreate indexes
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");
CREATE INDEX "Location_slug_idx" ON "Location"("slug");

-- Re-enable constraints (SQLite only)
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;