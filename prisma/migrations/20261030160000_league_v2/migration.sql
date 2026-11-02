-- Tee24 League v2: points-based winter league with weekly teams, straight +
-- handicapped individual leagues, weekly paid entries and a championship pot.

CREATE TABLE IF NOT EXISTS "League" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "locationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "description" TEXT,
  "weeklyFeeCents" INTEGER NOT NULL DEFAULT 1000,
  "minorAge" INTEGER NOT NULL DEFAULT 18,
  "firstPlacePct" INTEGER NOT NULL DEFAULT 50,
  "firstPlaceCapCents" INTEGER NOT NULL DEFAULT 10000,
  "secondPlacePct" INTEGER NOT NULL DEFAULT 25,
  "secondPlaceCapCents" INTEGER NOT NULL DEFAULT 5000,
  "championshipPotCents" INTEGER NOT NULL DEFAULT 0,
  "openingWeeks" INTEGER NOT NULL DEFAULT 2,
  "handicapCap" INTEGER NOT NULL DEFAULT 20,
  "throwOutEvery" INTEGER NOT NULL DEFAULT 3,
  "pointsTop5" INTEGER NOT NULL DEFAULT 3,
  "pointsTop10" INTEGER NOT NULL DEFAULT 2,
  "pointsTop15" INTEGER NOT NULL DEFAULT 1,
  "pointsTeamWin" INTEGER NOT NULL DEFAULT 2,
  "pointsTeamTie" INTEGER NOT NULL DEFAULT 1,
  "championshipAt" TIMESTAMP(3),
  "championshipTopPct" INTEGER NOT NULL DEFAULT 50,
  "championshipNote" TEXT,
  "gimmeDistanceFt" INTEGER NOT NULL DEFAULT 10,
  "mulligans" BOOLEAN NOT NULL DEFAULT false,
  "greenSpeed" TEXT NOT NULL DEFAULT 'Normal',
  "teeRules" JSONB,
  "rulesUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "League_locationId_status_idx" ON "League"("locationId", "status");
ALTER TABLE "League" ADD CONSTRAINT "League_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "LeagueWeek" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "weekNumber" INTEGER NOT NULL,
  "courseName" TEXT,
  "opensAt" TIMESTAMP(3) NOT NULL,
  "deadlineAt" TIMESTAMP(3) NOT NULL,
  "isChampionship" BOOLEAN NOT NULL DEFAULT false,
  "revealedAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "potCents" INTEGER NOT NULL DEFAULT 0,
  "paidOutCents" INTEGER NOT NULL DEFAULT 0,
  "toChampionshipCents" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeagueWeek_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeagueWeek_leagueId_weekNumber_key" ON "LeagueWeek"("leagueId", "weekNumber");
CREATE INDEX IF NOT EXISTS "LeagueWeek_deadlineAt_idx" ON "LeagueWeek"("deadlineAt");
ALTER TABLE "LeagueWeek" ADD CONSTRAINT "LeagueWeek_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "LeaguePlayer" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "displayName" TEXT,
  "aliases" JSONB,
  "isMinor" BOOLEAN NOT NULL DEFAULT false,
  "winningsEligible" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "joinedVia" TEXT NOT NULL DEFAULT 'APP',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeaguePlayer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeaguePlayer_leagueId_memberId_key" ON "LeaguePlayer"("leagueId", "memberId");
CREATE INDEX IF NOT EXISTS "LeaguePlayer_memberId_idx" ON "LeaguePlayer"("memberId");
ALTER TABLE "LeaguePlayer" ADD CONSTRAINT "LeaguePlayer_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaguePlayer" ADD CONSTRAINT "LeaguePlayer_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "LeagueEntry" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "weekId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "feeCents" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "source" TEXT NOT NULL DEFAULT 'APP',
  "invoiceId" TEXT,
  "chargeId" TEXT,
  "failureReason" TEXT,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeagueEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeagueEntry_weekId_playerId_key" ON "LeagueEntry"("weekId", "playerId");
CREATE INDEX IF NOT EXISTS "LeagueEntry_leagueId_status_idx" ON "LeagueEntry"("leagueId", "status");
ALTER TABLE "LeagueEntry" ADD CONSTRAINT "LeagueEntry_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueEntry" ADD CONSTRAINT "LeagueEntry_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "LeagueWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueEntry" ADD CONSTRAINT "LeagueEntry_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "LeaguePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "LeagueScorecardImage" (
  "id" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeagueScorecardImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeagueScore" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "weekId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "holes" JSONB NOT NULL,
  "front9" INTEGER NOT NULL,
  "back9" INTEGER NOT NULL,
  "gross" INTEGER NOT NULL,
  "handicap" INTEGER,
  "net" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "source" TEXT NOT NULL DEFAULT 'APP',
  "rejectReason" TEXT,
  "imageId" TEXT,
  "ocrText" JSONB,
  "ocrSettings" JSONB,
  "par" JSONB,
  "submittedByMemberId" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeagueScore_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeagueScore_imageId_key" ON "LeagueScore"("imageId");
CREATE UNIQUE INDEX IF NOT EXISTS "LeagueScore_weekId_playerId_key" ON "LeagueScore"("weekId", "playerId");
CREATE INDEX IF NOT EXISTS "LeagueScore_playerId_idx" ON "LeagueScore"("playerId");
ALTER TABLE "LeagueScore" ADD CONSTRAINT "LeagueScore_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueScore" ADD CONSTRAINT "LeagueScore_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "LeagueWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueScore" ADD CONSTRAINT "LeagueScore_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "LeaguePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueScore" ADD CONSTRAINT "LeagueScore_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "LeagueScorecardImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "LeagueHandicap" (
  "id" TEXT NOT NULL,
  "weekId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "handicap" INTEGER NOT NULL,
  "strokesBack" INTEGER,
  "roundsUsed" INTEGER NOT NULL DEFAULT 0,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeagueHandicap_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeagueHandicap_weekId_playerId_key" ON "LeagueHandicap"("weekId", "playerId");
ALTER TABLE "LeagueHandicap" ADD CONSTRAINT "LeagueHandicap_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "LeagueWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueHandicap" ADD CONSTRAINT "LeagueHandicap_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "LeaguePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "LeagueTeam" (
  "id" TEXT NOT NULL,
  "weekId" TEXT NOT NULL,
  "teamNumber" INTEGER NOT NULL,
  "player1Id" TEXT NOT NULL,
  "player2Id" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeagueTeam_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeagueTeam_weekId_teamNumber_key" ON "LeagueTeam"("weekId", "teamNumber");
CREATE INDEX IF NOT EXISTS "LeagueTeam_player1Id_idx" ON "LeagueTeam"("player1Id");
CREATE INDEX IF NOT EXISTS "LeagueTeam_player2Id_idx" ON "LeagueTeam"("player2Id");
ALTER TABLE "LeagueTeam" ADD CONSTRAINT "LeagueTeam_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "LeagueWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueTeam" ADD CONSTRAINT "LeagueTeam_player1Id_fkey" FOREIGN KEY ("player1Id") REFERENCES "LeaguePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueTeam" ADD CONSTRAINT "LeagueTeam_player2Id_fkey" FOREIGN KEY ("player2Id") REFERENCES "LeaguePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "LeagueMatch" (
  "id" TEXT NOT NULL,
  "weekId" TEXT NOT NULL,
  "team1Id" TEXT NOT NULL,
  "team2Id" TEXT,
  "team1Holes" INTEGER NOT NULL DEFAULT 0,
  "team2Holes" INTEGER NOT NULL DEFAULT 0,
  "winnerTeamId" TEXT,
  "outcome" TEXT NOT NULL DEFAULT 'NOT_PLAYED',
  "computedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeagueMatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LeagueMatch_weekId_idx" ON "LeagueMatch"("weekId");
ALTER TABLE "LeagueMatch" ADD CONSTRAINT "LeagueMatch_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "LeagueWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueMatch" ADD CONSTRAINT "LeagueMatch_team1Id_fkey" FOREIGN KEY ("team1Id") REFERENCES "LeagueTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueMatch" ADD CONSTRAINT "LeagueMatch_team2Id_fkey" FOREIGN KEY ("team2Id") REFERENCES "LeagueTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "LeagueWeekResult" (
  "id" TEXT NOT NULL,
  "weekId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "grossRank" INTEGER,
  "netRank" INTEGER,
  "grossPoints" INTEGER NOT NULL DEFAULT 0,
  "netPoints" INTEGER NOT NULL DEFAULT 0,
  "teamPoints" INTEGER NOT NULL DEFAULT 0,
  "totalPoints" INTEGER NOT NULL DEFAULT 0,
  "payoutCents" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeagueWeekResult_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeagueWeekResult_weekId_playerId_key" ON "LeagueWeekResult"("weekId", "playerId");
ALTER TABLE "LeagueWeekResult" ADD CONSTRAINT "LeagueWeekResult_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "LeagueWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueWeekResult" ADD CONSTRAINT "LeagueWeekResult_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "LeaguePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "LeaguePayout" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "weekId" TEXT,
  "playerId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "note" TEXT,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaguePayout_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LeaguePayout_playerId_idx" ON "LeaguePayout"("playerId");
CREATE INDEX IF NOT EXISTS "LeaguePayout_leagueId_weekId_idx" ON "LeaguePayout"("leagueId", "weekId");
ALTER TABLE "LeaguePayout" ADD CONSTRAINT "LeaguePayout_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaguePayout" ADD CONSTRAINT "LeaguePayout_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "LeagueWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaguePayout" ADD CONSTRAINT "LeaguePayout_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "LeaguePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Events link to League v2 by cuid. The legacy integer "leagueId" column (old
-- external league app) is left in place but no longer mapped by Prisma.
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "leagueRefId" TEXT;
CREATE INDEX IF NOT EXISTS "Event_leagueRefId_idx" ON "Event"("leagueRefId");
ALTER TABLE "Event" ADD CONSTRAINT "Event_leagueRefId_fkey" FOREIGN KEY ("leagueRefId") REFERENCES "League"("id") ON DELETE SET NULL ON UPDATE CASCADE;
