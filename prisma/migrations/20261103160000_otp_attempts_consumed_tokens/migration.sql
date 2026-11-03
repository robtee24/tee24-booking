-- OTP brute-force protection: count failed verifications per code
ALTER TABLE "Otp" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;

-- Single-use ledger for signed one-time tokens (portal magic links)
CREATE TABLE IF NOT EXISTS "ConsumedToken" (
  "jti"       TEXT NOT NULL,
  "purpose"   TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsumedToken_pkey" PRIMARY KEY ("jti")
);
CREATE INDEX IF NOT EXISTS "ConsumedToken_expiresAt_idx" ON "ConsumedToken"("expiresAt");
