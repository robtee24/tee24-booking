-- Gym Management Full Migration
-- Adds all new tables for the gym-management module suite (members ext, memberships, billing,
-- documents, attendance, marketing, automations, audit log, webhook delivery, etc.)

-- ============================================================
-- Organization
-- ============================================================
CREATE TABLE IF NOT EXISTS "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "brandColor" TEXT,
    "logoUrl" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "defaultTimezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "paypalAccount" TEXT,
    "squareLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_slug_key" ON "Organization"("slug");

-- ============================================================
-- Location additions
-- ============================================================
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "attendanceDedupeHours" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "reservationMatchBufferMin" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "addressLine1" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "addressLine2" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "zip" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "country" TEXT DEFAULT 'US';

DO $$ BEGIN ALTER TABLE "Location" ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Booking — link to member
-- ============================================================
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "memberId" TEXT;
CREATE INDEX IF NOT EXISTS "Booking_memberId_idx" ON "Booking"("memberId");

-- ============================================================
-- Admin extensions
-- ============================================================
ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS "twoFactorSecret" TEXT;
ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "Admin_email_key" ON "Admin"("email");

-- ============================================================
-- AdminPermission
-- ============================================================
CREATE TABLE IF NOT EXISTS "AdminPermission" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "organizationId" TEXT,
    "locationId" TEXT,
    "permission" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" TEXT,
    CONSTRAINT "AdminPermission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdminPermission_adminId_locationId_permission_key" ON "AdminPermission"("adminId", "locationId", "permission");
CREATE INDEX IF NOT EXISTS "AdminPermission_adminId_idx" ON "AdminPermission"("adminId");
CREATE INDEX IF NOT EXISTS "AdminPermission_locationId_idx" ON "AdminPermission"("locationId");

DO $$ BEGIN ALTER TABLE "AdminPermission" ADD CONSTRAINT "AdminPermission_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AdminPermission" ADD CONSTRAINT "AdminPermission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AdminPermission" ADD CONSTRAINT "AdminPermission_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- AdminNotification
-- ============================================================
CREATE TABLE IF NOT EXISTS "AdminNotification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "locationId" TEXT,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "snoozeUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminNotification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AdminNotification_organizationId_readAt_createdAt_idx" ON "AdminNotification"("organizationId", "readAt", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminNotification_locationId_readAt_createdAt_idx" ON "AdminNotification"("locationId", "readAt", "createdAt");

-- ============================================================
-- Member extensions
-- ============================================================
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "homeLocationId" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "squareCustomerId" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "kisiUserId" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "fullName" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "secondaryEmails" JSONB;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "secondaryPhones" JSONB;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "dob" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "gender" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "addressLine1" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "addressLine2" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "zip" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "country" TEXT DEFAULT 'US';
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "membershipStartDate" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "signupFee" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "membershipFees" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "membershipRecurrence" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "loginLink" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "magicLinkLastSentAt" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "optInEmailMarketing" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "optInSmsMarketing" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "smsConsentAt" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "smsConsentSource" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "referredById" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "familyAccountId" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "kisiAccessEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "kisiAccessReason" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "kisiAccessUpdatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Member_referralCode_key" ON "Member"("referralCode");
CREATE INDEX IF NOT EXISTS "Member_referralCode_idx" ON "Member"("referralCode");
CREATE INDEX IF NOT EXISTS "Member_referredById_idx" ON "Member"("referredById");
CREATE INDEX IF NOT EXISTS "Member_familyAccountId_idx" ON "Member"("familyAccountId");
CREATE INDEX IF NOT EXISTS "Member_squareCustomerId_idx" ON "Member"("squareCustomerId");

-- ============================================================
-- EmergencyContact
-- ============================================================
CREATE TABLE IF NOT EXISTS "EmergencyContact" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isEmergency" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EmergencyContact_memberId_idx" ON "EmergencyContact"("memberId");
DO $$ BEGIN ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- FamilyAccount + FamilyMember
-- ============================================================
CREATE TABLE IF NOT EXISTS "FamilyAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primaryMemberId" TEXT,
    "squareCustomerId" TEXT,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FamilyAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FamilyAccount_primaryMemberId_key" ON "FamilyAccount"("primaryMemberId");

CREATE TABLE IF NOT EXISTS "FamilyMember" (
    "id" TEXT NOT NULL,
    "familyAccountId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FamilyMember_memberId_key" ON "FamilyMember"("memberId");
CREATE INDEX IF NOT EXISTS "FamilyMember_familyAccountId_idx" ON "FamilyMember"("familyAccountId");

DO $$ BEGIN ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_familyAccountId_fkey" FOREIGN KEY ("familyAccountId") REFERENCES "FamilyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- MembershipPlan + overrides
-- ============================================================
CREATE TABLE IF NOT EXISTS "MembershipPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "productType" TEXT NOT NULL DEFAULT 'RECURRING',
    "category" TEXT NOT NULL DEFAULT 'MEMBER',
    "signupFeeCents" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "billingCadence" TEXT NOT NULL DEFAULT 'MONTHLY',
    "durationDays" INTEGER,
    "cancellationPolicy" JSONB,
    "freezePolicy" JSONB,
    "refundPolicy" JSONB,
    "familyBundle" BOOLEAN NOT NULL DEFAULT false,
    "familyDiscountConfig" JSONB,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "allowedLocations" TEXT,
    "autoApplyTagIds" JSONB,
    "autoEnrollAutomationIds" JSONB,
    "kisiDoorGroups" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "MembershipPricingOverride" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "signupFeeCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MembershipPricingOverride_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MembershipPricingOverride_planId_locationId_key" ON "MembershipPricingOverride"("planId", "locationId");
DO $$ BEGIN ALTER TABLE "MembershipPricingOverride" ADD CONSTRAINT "MembershipPricingOverride_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- MembershipSubscription
-- ============================================================
CREATE TABLE IF NOT EXISTS "MembershipSubscription" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "paidThroughDate" TIMESTAMP(3),
    "squareSubscriptionId" TEXT,
    "priceCents" INTEGER NOT NULL,
    "signupFeeCents" INTEGER NOT NULL DEFAULT 0,
    "billingCadence" TEXT NOT NULL,
    "cancelScheduledFor" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "cancellationNotes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "freezeStartDate" TIMESTAMP(3),
    "freezeResumeDate" TIMESTAMP(3),
    "freezeReason" TEXT,
    "freezeFeeCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MembershipSubscription_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MembershipSubscription_memberId_status_idx" ON "MembershipSubscription"("memberId", "status");
CREATE INDEX IF NOT EXISTS "MembershipSubscription_planId_idx" ON "MembershipSubscription"("planId");
CREATE INDEX IF NOT EXISTS "MembershipSubscription_locationId_status_idx" ON "MembershipSubscription"("locationId", "status");
CREATE INDEX IF NOT EXISTS "MembershipSubscription_squareSubscriptionId_idx" ON "MembershipSubscription"("squareSubscriptionId");

DO $$ BEGIN ALTER TABLE "MembershipSubscription" ADD CONSTRAINT "MembershipSubscription_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "MembershipSubscription" ADD CONSTRAINT "MembershipSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "MembershipSubscription" ADD CONSTRAINT "MembershipSubscription_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- PaymentMethod, Invoice, InvoiceLineItem, Charge, Refund
-- ============================================================
CREATE TABLE IF NOT EXISTS "PaymentMethod" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "squareCardId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'CARD',
    "brand" TEXT,
    "last4" TEXT,
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isFamilyShared" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentMethod_squareCardId_key" ON "PaymentMethod"("squareCardId");
CREATE INDEX IF NOT EXISTS "PaymentMethod_memberId_isDefault_idx" ON "PaymentMethod"("memberId", "isDefault");
DO $$ BEGIN ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Invoice" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "organizationId" TEXT,
    "locationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "description" TEXT,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "squareInvoiceId" TEXT,
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_squareInvoiceId_key" ON "Invoice"("squareInvoiceId");
CREATE INDEX IF NOT EXISTS "Invoice_locationId_status_dueDate_idx" ON "Invoice"("locationId", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "Invoice_memberId_status_idx" ON "Invoice"("memberId", "status");
CREATE INDEX IF NOT EXISTS "Invoice_subscriptionId_idx" ON "Invoice"("subscriptionId");

DO $$ BEGIN ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "MembershipSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");
DO $$ BEGIN ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Charge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "locationId" TEXT,
    "memberId" TEXT,
    "invoiceId" TEXT,
    "subscriptionId" TEXT,
    "paymentMethodId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "squarePaymentId" TEXT,
    "failureReason" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Charge_squarePaymentId_key" ON "Charge"("squarePaymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "Charge_idempotencyKey_key" ON "Charge"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "Charge_memberId_status_idx" ON "Charge"("memberId", "status");
CREATE INDEX IF NOT EXISTS "Charge_invoiceId_idx" ON "Charge"("invoiceId");
CREATE INDEX IF NOT EXISTS "Charge_subscriptionId_idx" ON "Charge"("subscriptionId");

DO $$ BEGIN ALTER TABLE "Charge" ADD CONSTRAINT "Charge_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Charge" ADD CONSTRAINT "Charge_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Charge" ADD CONSTRAINT "Charge_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "MembershipSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Charge" ADD CONSTRAINT "Charge_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Refund" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT,
    "squareRefundId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "refundedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Refund_squareRefundId_key" ON "Refund"("squareRefundId");
CREATE INDEX IF NOT EXISTS "Refund_chargeId_idx" ON "Refund"("chargeId");
DO $$ BEGIN ALTER TABLE "Refund" ADD CONSTRAINT "Refund_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Refund" ADD CONSTRAINT "Refund_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Discounts
-- ============================================================
CREATE TABLE IF NOT EXISTS "Discount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PERCENT',
    "value" INTEGER NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'ONE_TIME',
    "recurringMonths" INTEGER,
    "maxRedemptions" INTEGER,
    "perMemberLimit" INTEGER,
    "totalRedemptions" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "signupFormIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Discount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Discount_code_key" ON "Discount"("code");
CREATE INDEX IF NOT EXISTS "Discount_code_idx" ON "Discount"("code");

CREATE TABLE IF NOT EXISTS "DiscountPlanRestriction" (
    "id" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    CONSTRAINT "DiscountPlanRestriction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DiscountPlanRestriction_discountId_planId_key" ON "DiscountPlanRestriction"("discountId", "planId");
DO $$ BEGIN ALTER TABLE "DiscountPlanRestriction" ADD CONSTRAINT "DiscountPlanRestriction_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "DiscountPlanRestriction" ADD CONSTRAINT "DiscountPlanRestriction_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "DiscountApplication" (
    "id" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "memberId" TEXT,
    "invoiceId" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amountCents" INTEGER NOT NULL,
    CONSTRAINT "DiscountApplication_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DiscountApplication_memberId_idx" ON "DiscountApplication"("memberId");
CREATE INDEX IF NOT EXISTS "DiscountApplication_invoiceId_idx" ON "DiscountApplication"("invoiceId");
DO $$ BEGIN ALTER TABLE "DiscountApplication" ADD CONSTRAINT "DiscountApplication_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- MemberCredit
-- ============================================================
CREATE TABLE IF NOT EXISTS "MemberCredit" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "MemberCredit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MemberCredit_memberId_createdAt_idx" ON "MemberCredit"("memberId", "createdAt");
DO $$ BEGIN ALTER TABLE "MemberCredit" ADD CONSTRAINT "MemberCredit_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Documents
-- ============================================================
CREATE TABLE IF NOT EXISTS "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceFileUrl" TEXT,
    "bodyHtml" TEXT,
    "fieldsConfig" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "requiredAtSignup" BOOLEAN NOT NULL DEFAULT false,
    "expiresAfterDays" INTEGER,
    "graceAfterExpiryDays" INTEGER DEFAULT 7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "DocumentAssignment" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "versionAtAssign" INTEGER NOT NULL,
    "signingToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "pdfHash" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DocumentAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentAssignment_signingToken_key" ON "DocumentAssignment"("signingToken");
CREATE INDEX IF NOT EXISTS "DocumentAssignment_memberId_status_idx" ON "DocumentAssignment"("memberId", "status");
CREATE INDEX IF NOT EXISTS "DocumentAssignment_documentId_idx" ON "DocumentAssignment"("documentId");
DO $$ BEGIN ALTER TABLE "DocumentAssignment" ADD CONSTRAINT "DocumentAssignment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "DocumentAssignment" ADD CONSTRAINT "DocumentAssignment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "SignatureEvent" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "signatureSvg" TEXT,
    "initialsSvg" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "signedOnBehalfBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignatureEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SignatureEvent_assignmentId_idx" ON "SignatureEvent"("assignmentId");
DO $$ BEGIN ALTER TABLE "SignatureEvent" ADD CONSTRAINT "SignatureEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "DocumentAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "SignatureEvent" ADD CONSTRAINT "SignatureEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Tags
-- ============================================================
CREATE TABLE IF NOT EXISTS "Tag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT DEFAULT '#16a34a',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_organizationId_name_key" ON "Tag"("organizationId", "name");
DO $$ BEGIN ALTER TABLE "Tag" ADD CONSTRAINT "Tag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "MemberTag" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "taggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taggedById" TEXT,
    CONSTRAINT "MemberTag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MemberTag_memberId_tagId_key" ON "MemberTag"("memberId", "tagId");
DO $$ BEGIN ALTER TABLE "MemberTag" ADD CONSTRAINT "MemberTag_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "MemberTag" ADD CONSTRAINT "MemberTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Custom fields
-- ============================================================
CREATE TABLE IF NOT EXISTS "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "showOnSignup" BOOLEAN NOT NULL DEFAULT false,
    "showOnProfile" BOOLEAN NOT NULL DEFAULT true,
    "adminOnly" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomFieldDefinition_organizationId_key_key" ON "CustomFieldDefinition"("organizationId", "key");
DO $$ BEGIN ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "CustomFieldValue" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "valueText" TEXT,
    "valueNumber" DOUBLE PRECISION,
    "valueDate" TIMESTAMP(3),
    "valueJson" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomFieldValue_fieldId_memberId_key" ON "CustomFieldValue"("fieldId", "memberId");
DO $$ BEGIN ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CustomFieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Notes
-- ============================================================
CREATE TABLE IF NOT EXISTS "MemberNote" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemberNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MemberNote_memberId_createdAt_idx" ON "MemberNote"("memberId", "createdAt");
DO $$ BEGIN ALTER TABLE "MemberNote" ADD CONSTRAINT "MemberNote_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "InternalNote" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InternalNote_memberId_createdAt_idx" ON "InternalNote"("memberId", "createdAt");
DO $$ BEGIN ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Visits
-- ============================================================
CREATE TABLE IF NOT EXISTS "Visit" (
    "id" TEXT NOT NULL,
    "memberId" TEXT,
    "visitorId" TEXT,
    "locationId" TEXT NOT NULL,
    "bayId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'WALK_IN',
    "source" TEXT NOT NULL DEFAULT 'KISI',
    "enteredAt" TIMESTAMP(3) NOT NULL,
    "exitedAt" TIMESTAMP(3),
    "bookingId" TEXT,
    "kisiEventId" TEXT,
    "notes" TEXT,
    "dedupedFromAt" TIMESTAMP(3),
    "unlockCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Visit_kisiEventId_key" ON "Visit"("kisiEventId");
CREATE INDEX IF NOT EXISTS "Visit_memberId_enteredAt_idx" ON "Visit"("memberId", "enteredAt");
CREATE INDEX IF NOT EXISTS "Visit_locationId_enteredAt_idx" ON "Visit"("locationId", "enteredAt");
CREATE INDEX IF NOT EXISTS "Visit_visitorId_enteredAt_idx" ON "Visit"("visitorId", "enteredAt");
CREATE INDEX IF NOT EXISTS "Visit_bookingId_idx" ON "Visit"("bookingId");

DO $$ BEGIN ALTER TABLE "Visit" ADD CONSTRAINT "Visit_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Visit" ADD CONSTRAINT "Visit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Visit" ADD CONSTRAINT "Visit_bayId_fkey" FOREIGN KEY ("bayId") REFERENCES "Bay"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- UsageTierSnapshot, ChurnRiskScore, ChurnLabel
-- ============================================================
CREATE TABLE IF NOT EXISTS "UsageTierSnapshot" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "visits30d" INTEGER NOT NULL,
    "visits90d" INTEGER NOT NULL,
    "cohortPercentile" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageTierSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "UsageTierSnapshot_memberId_computedAt_idx" ON "UsageTierSnapshot"("memberId", "computedAt");
DO $$ BEGIN ALTER TABLE "UsageTierSnapshot" ADD CONSTRAINT "UsageTierSnapshot_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ChurnRiskScore" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "modelVersion" TEXT NOT NULL DEFAULT 'v1-rules',
    "features" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChurnRiskScore_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ChurnRiskScore_memberId_computedAt_idx" ON "ChurnRiskScore"("memberId", "computedAt");
DO $$ BEGIN ALTER TABLE "ChurnRiskScore" ADD CONSTRAINT "ChurnRiskScore_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ChurnLabel" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "features30d" JSONB NOT NULL,
    "features60d" JSONB NOT NULL,
    "features90d" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChurnLabel_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ChurnLabel_memberId_idx" ON "ChurnLabel"("memberId");

-- ============================================================
-- Visitors
-- ============================================================
CREATE TABLE IF NOT EXISTS "Visitor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "locationId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "source" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "convertedToMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Visitor_convertedToMemberId_key" ON "Visitor"("convertedToMemberId");
CREATE INDEX IF NOT EXISTS "Visitor_organizationId_stage_idx" ON "Visitor"("organizationId", "stage");
CREATE INDEX IF NOT EXISTS "Visitor_locationId_stage_idx" ON "Visitor"("locationId", "stage");
CREATE INDEX IF NOT EXISTS "Visitor_email_idx" ON "Visitor"("email");
CREATE INDEX IF NOT EXISTS "Visitor_phone_idx" ON "Visitor"("phone");
DO $$ BEGIN ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_convertedToMemberId_fkey" FOREIGN KEY ("convertedToMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Visit" ADD CONSTRAINT "Visit_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "VisitorEvent" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitorEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "VisitorEvent_visitorId_createdAt_idx" ON "VisitorEvent"("visitorId", "createdAt");
DO $$ BEGIN ALTER TABLE "VisitorEvent" ADD CONSTRAINT "VisitorEvent_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- SignupForm
-- ============================================================
CREATE TABLE IF NOT EXISTS "SignupForm" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "locationId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "allowedPlanIds" JSONB,
    "defaultPlanId" TEXT,
    "requiredFields" JSONB,
    "customFieldIds" JSONB,
    "requiredDocumentIds" JSONB,
    "allowDiscountCode" BOOLEAN NOT NULL DEFAULT true,
    "autoApplyDiscountId" TEXT,
    "photoRequired" BOOLEAN NOT NULL DEFAULT false,
    "authSetup" TEXT NOT NULL DEFAULT 'MAGIC_LINK',
    "themeOverrides" JSONB,
    "confirmationUrl" TEXT,
    "collectTax" BOOLEAN NOT NULL DEFAULT false,
    "autoTagIds" JSONB,
    "autoEnrollAutomationIds" JSONB,
    "embedAllowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SignupForm_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SignupForm_slug_key" ON "SignupForm"("slug");
CREATE INDEX IF NOT EXISTS "SignupForm_organizationId_active_idx" ON "SignupForm"("organizationId", "active");
DO $$ BEGIN ALTER TABLE "SignupForm" ADD CONSTRAINT "SignupForm_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "SignupForm" ADD CONSTRAINT "SignupForm_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Messaging
-- ============================================================
CREATE TABLE IF NOT EXISTS "MessageTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'MARKETING',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Conversation" (
    "id" TEXT NOT NULL,
    "memberId" TEXT,
    "visitorId" TEXT,
    "locationId" TEXT,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Conversation_memberId_status_lastMessageAt_idx" ON "Conversation"("memberId", "status", "lastMessageAt");
DO $$ BEGIN ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "memberId" TEXT,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "category" TEXT NOT NULL DEFAULT 'MARKETING',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "providerId" TEXT,
    "providerError" TEXT,
    "templateId" TEXT,
    "sentByAdminId" TEXT,
    "sentByAutomationId" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Message_memberId_createdAt_idx" ON "Message"("memberId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_conversationId_idx" ON "Message"("conversationId");
CREATE INDEX IF NOT EXISTS "Message_providerId_idx" ON "Message"("providerId");
DO $$ BEGIN ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Message" ADD CONSTRAINT "Message_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Automations
-- ============================================================
CREATE TABLE IF NOT EXISTS "Automation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT NOT NULL,
    "triggerConfig" JSONB,
    "goalConfig" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "maxSteps" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN ALTER TABLE "Automation" ADD CONSTRAINT "Automation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AutomationStep" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    CONSTRAINT "AutomationStep_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationStep_automationId_order_key" ON "AutomationStep"("automationId", "order");
CREATE INDEX IF NOT EXISTS "AutomationStep_automationId_idx" ON "AutomationStep"("automationId");
DO $$ BEGIN ALTER TABLE "AutomationStep" ADD CONSTRAINT "AutomationStep_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AutomationEnrollment" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "exitReason" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "AutomationEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationEnrollment_automationId_memberId_key" ON "AutomationEnrollment"("automationId", "memberId");
CREATE INDEX IF NOT EXISTS "AutomationEnrollment_automationId_status_idx" ON "AutomationEnrollment"("automationId", "status");
CREATE INDEX IF NOT EXISTS "AutomationEnrollment_memberId_status_idx" ON "AutomationEnrollment"("memberId", "status");
DO $$ BEGIN ALTER TABLE "AutomationEnrollment" ADD CONSTRAINT "AutomationEnrollment_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AutomationEnrollment" ADD CONSTRAINT "AutomationEnrollment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AutomationEvent" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AutomationEvent_enrollmentId_idx" ON "AutomationEvent"("enrollmentId");
DO $$ BEGIN ALTER TABLE "AutomationEvent" ADD CONSTRAINT "AutomationEvent_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "AutomationEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Referrals
-- ============================================================
CREATE TABLE IF NOT EXISTS "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredMemberId" TEXT NOT NULL,
    "signupFormId" TEXT,
    "discountAppliedId" TEXT,
    "payoutId" TEXT,
    "earnedCents" INTEGER NOT NULL DEFAULT 0,
    "earnedKind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Referral_referredMemberId_key" ON "Referral"("referredMemberId");
CREATE INDEX IF NOT EXISTS "Referral_referrerId_idx" ON "Referral"("referrerId");
CREATE INDEX IF NOT EXISTS "Referral_payoutId_idx" ON "Referral"("payoutId");

CREATE TABLE IF NOT EXISTS "ReferralPayout" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paypalTxnId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    CONSTRAINT "ReferralPayout_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ReferralPayout_referrerId_status_idx" ON "ReferralPayout"("referrerId", "status");

CREATE TABLE IF NOT EXISTS "PaypalAccount" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "paypalEmail" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaypalAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PaypalAccount_memberId_key" ON "PaypalAccount"("memberId");
DO $$ BEGIN ALTER TABLE "PaypalAccount" ADD CONSTRAINT "PaypalAccount_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS "Task" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "locationId" TEXT,
    "memberId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "assignedToId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "dueAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Task_assignedToId_status_idx" ON "Task"("assignedToId", "status");
CREATE INDEX IF NOT EXISTS "Task_locationId_status_idx" ON "Task"("locationId", "status");
CREATE INDEX IF NOT EXISTS "Task_memberId_idx" ON "Task"("memberId");
DO $$ BEGIN ALTER TABLE "Task" ADD CONSTRAINT "Task_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Operational logs
-- ============================================================
CREATE TABLE IF NOT EXISTS "MaintenanceLog" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "bayId" TEXT,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "reporterId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaintenanceLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MaintenanceLog_locationId_createdAt_idx" ON "MaintenanceLog"("locationId", "createdAt");
CREATE INDEX IF NOT EXISTS "MaintenanceLog_bayId_idx" ON "MaintenanceLog"("bayId");
DO $$ BEGIN ALTER TABLE "MaintenanceLog" ADD CONSTRAINT "MaintenanceLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "MaintenanceLog" ADD CONSTRAINT "MaintenanceLog_bayId_fkey" FOREIGN KEY ("bayId") REFERENCES "Bay"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Checklist" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemsConfig" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Checklist_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ChecklistRun" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "completedById" TEXT,
    "responses" JSONB NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChecklistRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ChecklistRun_checklistId_completedAt_idx" ON "ChecklistRun"("checklistId", "completedAt");
DO $$ BEGIN ALTER TABLE "ChecklistRun" ADD CONSTRAINT "ChecklistRun_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "Checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- AuditLog + WebhookDelivery
-- ============================================================
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "actorId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
DO $$ BEGIN ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "signature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookDelivery_provider_externalId_key" ON "WebhookDelivery"("provider", "externalId");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_provider_status_createdAt_idx" ON "WebhookDelivery"("provider", "status", "createdAt");
