-- RedefineTables
-- SQLite: Use PRAGMA to safely recreate table with FK references
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Create updated Location table with new optional template columns
CREATE TABLE "new_Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "bookingNote" TEXT NOT NULL DEFAULT '',
    "emailTemplate" TEXT,
    "smsTemplate" TEXT
);

-- Copy existing data; new columns will be NULL (or default for bookingNote)
INSERT INTO "new_Location" ("id", "name", "slug", "bookingNote")
SELECT "id", "name", "slug", COALESCE("bookingNote", '')
FROM "Location";

-- Replace old table
DROP TABLE "Location";
ALTER TABLE "new_Location" RENAME TO "Location";

-- Recreate indexes
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");
CREATE INDEX "Location_slug_idx" ON "Location"("slug");

-- Re-enable constraints
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;