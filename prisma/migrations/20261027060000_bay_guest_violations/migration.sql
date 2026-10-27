-- CreateTable
CREATE TABLE "BookingCompanion" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "includedGuests" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingCompanion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestViolation" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "bayNumber" INTEGER NOT NULL,
    "bookingId" TEXT,
    "memberId" TEXT,
    "deviceId" TEXT NOT NULL,
    "screen" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'PROCEEDED',
    "playerCount" INTEGER NOT NULL,
    "allowedPlayers" INTEGER NOT NULL,
    "extraGuests" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestViolation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingCompanion_bookingId_memberId_key" ON "BookingCompanion"("bookingId", "memberId");
CREATE INDEX "BookingCompanion_memberId_idx" ON "BookingCompanion"("memberId");
CREATE INDEX "GuestViolation_locationId_createdAt_idx" ON "GuestViolation"("locationId", "createdAt");
CREATE INDEX "GuestViolation_bookingId_idx" ON "GuestViolation"("bookingId");
CREATE INDEX "GuestViolation_memberId_idx" ON "GuestViolation"("memberId");

-- AddForeignKey
ALTER TABLE "BookingCompanion" ADD CONSTRAINT "BookingCompanion_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingCompanion" ADD CONSTRAINT "BookingCompanion_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuestViolation" ADD CONSTRAINT "GuestViolation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
