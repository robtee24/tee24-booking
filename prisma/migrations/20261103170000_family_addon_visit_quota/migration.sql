-- Family add-on subscriptions (billed to the account holder) + visit-quota notice bookmark. Additive.
ALTER TABLE "MembershipSubscription" ADD COLUMN IF NOT EXISTS "quotaNotifiedPeriodStart" TIMESTAMP(3);
ALTER TABLE "MembershipSubscription" ADD COLUMN IF NOT EXISTS "billedToMemberId" TEXT;
ALTER TABLE "MembershipSubscription" ADD COLUMN IF NOT EXISTS "familyOfSubscriptionId" TEXT;
ALTER TABLE "MembershipSubscription" ADD COLUMN IF NOT EXISTS "familyDiscountPercent" INTEGER;

CREATE INDEX IF NOT EXISTS "MembershipSubscription_billedToMemberId_idx" ON "MembershipSubscription"("billedToMemberId");
CREATE INDEX IF NOT EXISTS "MembershipSubscription_familyOfSubscriptionId_idx" ON "MembershipSubscription"("familyOfSubscriptionId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MembershipSubscription_billedToMemberId_fkey') THEN
    ALTER TABLE "MembershipSubscription"
      ADD CONSTRAINT "MembershipSubscription_billedToMemberId_fkey"
      FOREIGN KEY ("billedToMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MembershipSubscription_familyOfSubscriptionId_fkey') THEN
    ALTER TABLE "MembershipSubscription"
      ADD CONSTRAINT "MembershipSubscription_familyOfSubscriptionId_fkey"
      FOREIGN KEY ("familyOfSubscriptionId") REFERENCES "MembershipSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
