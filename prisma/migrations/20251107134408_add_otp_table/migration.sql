-- prisma/migrations/20251107134408_add_otp_table/migration.sql
-- CreateTable
CREATE TABLE IF NOT EXISTS "Otp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Otp_phone_key" ON "Otp"("phone");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Otp_phone_idx" ON "Otp"("phone");