-- AlterTable
ALTER TABLE "Member" ADD COLUMN "fullName" TEXT;
ALTER TABLE "Member" ADD COLUMN "dob" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN "gender" TEXT;
ALTER TABLE "Member" ADD COLUMN "membershipStartDate" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN "signupFee" TEXT;
ALTER TABLE "Member" ADD COLUMN "membershipFees" TEXT;
ALTER TABLE "Member" ADD COLUMN "membershipRecurrence" TEXT;
ALTER TABLE "Member" ADD COLUMN "loginLink" TEXT;
