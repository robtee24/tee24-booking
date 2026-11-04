-- Dunning: what to do with an invoice that is still unpaid at the next renewal. Additive.
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "unpaidRenewalAction" TEXT NOT NULL DEFAULT 'CANCEL';
