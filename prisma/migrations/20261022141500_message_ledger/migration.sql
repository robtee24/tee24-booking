-- Message ledger: location + source context so every outbound/inbound
-- email/SMS (including ones to non-members) can be listed and filtered.
ALTER TABLE "Message" ADD COLUMN "locationId" TEXT;
ALTER TABLE "Message" ADD COLUMN "source" TEXT;

CREATE INDEX "Message_locationId_createdAt_idx" ON "Message"("locationId", "createdAt");
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");
