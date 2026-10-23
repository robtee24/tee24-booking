-- Member profile photos (bytes in DB, served via /api/members/[id]/photo)
CREATE TABLE "MemberPhoto" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MemberPhoto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MemberPhoto_memberId_key" ON "MemberPhoto"("memberId");
ALTER TABLE "MemberPhoto" ADD CONSTRAINT "MemberPhoto_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Parent / guardian co-signature on waivers signed by minors
ALTER TABLE "SignatureEvent" ADD COLUMN "guardianName" TEXT, ADD COLUMN "guardianSignatureSvg" TEXT;
