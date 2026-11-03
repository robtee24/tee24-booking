-- League v2: weekly notification bookmarks + public signup list (additive).
ALTER TABLE "LeagueWeek" ADD COLUMN IF NOT EXISTS "openNotifiedAt" TIMESTAMP(3);
ALTER TABLE "LeagueWeek" ADD COLUMN IF NOT EXISTS "resultsNotifiedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "LeagueSubscriber" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "memberId" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "notifyWeekly" BOOLEAN NOT NULL DEFAULT true,
    "joinRequested" BOOLEAN NOT NULL DEFAULT true,
    "joinedLeagueId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "token" TEXT NOT NULL,
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueSubscriber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LeagueSubscriber_phone_key" ON "LeagueSubscriber"("phone");
CREATE UNIQUE INDEX IF NOT EXISTS "LeagueSubscriber_token_key" ON "LeagueSubscriber"("token");
CREATE INDEX IF NOT EXISTS "LeagueSubscriber_memberId_idx" ON "LeagueSubscriber"("memberId");
CREATE INDEX IF NOT EXISTS "LeagueSubscriber_organizationId_idx" ON "LeagueSubscriber"("organizationId");
