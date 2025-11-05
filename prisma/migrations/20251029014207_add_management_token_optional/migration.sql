-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "canceledAt" DATETIME;
ALTER TABLE "Booking" ADD COLUMN "managementToken" TEXT;

-- CreateIndex
CREATE INDEX "Booking_email_start_idx" ON "Booking"("email", "start");
