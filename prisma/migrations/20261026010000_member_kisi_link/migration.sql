-- CreateTable
CREATE TABLE "MemberKisiLink" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kisiUserId" TEXT NOT NULL,
    "kisiMemberId" TEXT,
    "email" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinkedAt" TIMESTAMP(3),
    "unlinkReason" TEXT,

    CONSTRAINT "MemberKisiLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberKisiLink_memberId_idx" ON "MemberKisiLink"("memberId");
CREATE INDEX "MemberKisiLink_kisiUserId_idx" ON "MemberKisiLink"("kisiUserId");

-- AddForeignKey
ALTER TABLE "MemberKisiLink" ADD CONSTRAINT "MemberKisiLink_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
