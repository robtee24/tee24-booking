-- AlterTable: Add bay app settings to Location
ALTER TABLE "Location" ADD COLUMN "bayAppEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Location" ADD COLUMN "bayAppUnlockMinutes" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Location" ADD COLUMN "bayAppWarningMinutes" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Location" ADD COLUMN "bayAppAutoCancelOnTimeout" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: Add checkedInAt to Booking
ALTER TABLE "Booking" ADD COLUMN "checkedInAt" TIMESTAMP(3);

-- CreateTable: BayAppRegistration
CREATE TABLE "BayAppRegistration" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "bayNumber" INTEGER NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BayAppRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BayAppRegistration_deviceId_key" ON "BayAppRegistration"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "BayAppRegistration_locationId_bayNumber_key" ON "BayAppRegistration"("locationId", "bayNumber");

-- AddForeignKey
ALTER TABLE "BayAppRegistration" ADD CONSTRAINT "BayAppRegistration_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
