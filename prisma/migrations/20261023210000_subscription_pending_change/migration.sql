-- Self-service scheduled downgrades: applied by recurring billing at pendingChangeAt.
ALTER TABLE "MembershipSubscription" ADD COLUMN "pendingPlanId" TEXT;
ALTER TABLE "MembershipSubscription" ADD COLUMN "pendingGuestCount" INTEGER;
ALTER TABLE "MembershipSubscription" ADD COLUMN "pendingPriceCents" INTEGER;
ALTER TABLE "MembershipSubscription" ADD COLUMN "pendingChangeAt" TIMESTAMP(3);
