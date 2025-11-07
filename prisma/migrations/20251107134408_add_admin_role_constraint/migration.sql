-- prisma/migrations/20251107_add_admin_role_enum/migration.sql
-- Creates AdminRole enum + converts Admin.role to native enum
-- Safe for existing data, constraints, and relationships

-- 1. Create the enum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AdminRole') THEN
    CREATE TYPE "AdminRole" AS ENUM ('ROOT', 'FULL', 'SCOPED');
  END IF;
END $$;

-- 2. Begin transaction for atomic table redefine
BEGIN;

-- 3. Drop old index Admin_phone_key
DROP INDEX IF EXISTS "Admin_phone_key";

-- 4. Create new table with enum
CREATE TABLE "new_Admin" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "phone" TEXT NOT NULL,
  "name" TEXT,
  "role" "AdminRole" NOT NULL DEFAULT 'SCOPED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Admin_phone_key" UNIQUE ("phone")
);

-- 5. Copy data with explicit cast
INSERT INTO "new_Admin" ("id", "phone", "name", "role", "createdAt", "updatedAt")
SELECT 
  "id",
  "phone",
  "name",
  "role"::text::"AdminRole",
  "createdAt",
  "updatedAt"
FROM "Admin";

-- 6. Drop old foreign key from AdminLocation
ALTER TABLE "AdminLocation" DROP CONSTRAINT IF EXISTS "AdminLocation_adminId_fkey";

-- 7. Drop old table
DROP TABLE "Admin";

-- 8. Rename new table
ALTER TABLE "new_Admin" RENAME TO "Admin";

-- 9. Recreate unique index
CREATE UNIQUE INDEX IF NOT EXISTS "Admin_phone_key" ON "Admin"("phone");

-- 10. Recreate foreign key
ALTER TABLE "AdminLocation"
  ADD CONSTRAINT "AdminLocation_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "Admin" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;