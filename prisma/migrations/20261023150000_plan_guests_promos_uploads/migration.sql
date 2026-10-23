-- Guest add-ons on plans
ALTER TABLE "MembershipPlan" ADD COLUMN "guestAddonCents" INTEGER;
ALTER TABLE "MembershipPlan" ADD COLUMN "maxGuests" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MembershipPlan" ADD COLUMN "dayPassGuestPricing" JSONB;
ALTER TABLE "MembershipPlan" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Guest / promo / commitment snapshot on subscriptions
ALTER TABLE "MembershipSubscription" ADD COLUMN "guestCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MembershipSubscription" ADD COLUMN "guestCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MembershipSubscription" ADD COLUMN "promoDiscountId" TEXT;
ALTER TABLE "MembershipSubscription" ADD COLUMN "commitmentMonths" INTEGER;
ALTER TABLE "MembershipSubscription" ADD COLUMN "commitmentEndsAt" TIMESTAMP(3);
ALTER TABLE "MembershipSubscription" ADD COLUMN "earlyCancelFeeCents" INTEGER;

-- Signup promotion config on discounts
ALTER TABLE "Discount" ADD COLUMN "showOnSignup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Discount" ADD COLUMN "signupTitle" TEXT;
ALTER TABLE "Discount" ADD COLUMN "signupDescription" TEXT;
ALTER TABLE "Discount" ADD COLUMN "requiresIdUpload" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Discount" ADD COLUMN "idUploadLabel" TEXT;
ALTER TABLE "Discount" ADD COLUMN "commitmentMonths" INTEGER;
ALTER TABLE "Discount" ADD COLUMN "commitmentAcknowledgement" TEXT;
ALTER TABLE "Discount" ADD COLUMN "earlyCancelPolicy" TEXT;
ALTER TABLE "Discount" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Member uploads (ID verification)
CREATE TABLE "MemberUpload" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "discountId" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemberUpload_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MemberUpload_memberId_idx" ON "MemberUpload"("memberId");
CREATE INDEX "MemberUpload_status_idx" ON "MemberUpload"("status");
ALTER TABLE "MemberUpload" ADD CONSTRAINT "MemberUpload_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
