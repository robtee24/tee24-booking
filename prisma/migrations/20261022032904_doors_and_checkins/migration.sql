-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "actorEmail" TEXT,
ADD COLUMN     "doorId" TEXT,
ADD COLUMN     "matchedBy" TEXT;

-- CreateTable
CREATE TABLE "Door" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "kisiLockId" INTEGER NOT NULL,
    "kisiPlaceId" INTEGER,
    "kisiPlaceName" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "locationId" TEXT,
    "configured" BOOLEAN,
    "online" BOOLEAN,
    "open" BOOLEAN,
    "unlocked" BOOLEAN,
    "lockedDown" BOOLEAN,
    "lastStatusAt" TIMESTAMP(3),
    "lastUnlockAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Door_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationState" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationState_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Door_kisiLockId_key" ON "Door"("kisiLockId");

-- CreateIndex
CREATE INDEX "Door_locationId_idx" ON "Door"("locationId");

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_doorId_fkey" FOREIGN KEY ("doorId") REFERENCES "Door"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Door" ADD CONSTRAINT "Door_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

