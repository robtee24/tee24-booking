-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "gymDeskId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "membershipType" TEXT,
    "joinDate" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'CSV',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Member_locationId_status_idx" ON "Member"("locationId", "status");

-- CreateIndex
CREATE INDEX "Member_locationId_phone_idx" ON "Member"("locationId", "phone");

-- CreateIndex
CREATE INDEX "Member_email_idx" ON "Member"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Member_locationId_email_key" ON "Member"("locationId", "email");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
