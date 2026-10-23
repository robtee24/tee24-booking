-- Mobile member app: device binding, long-lived sessions, device transfer
-- requests, events, game-improvement models, plan visit allowances and
-- location geofence for door unlocks.

-- Location geofence
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "unlockRadiusMeters" INTEGER NOT NULL DEFAULT 150;

-- Plan visit allowance (rolling period from subscription start)
ALTER TABLE "MembershipPlan" ADD COLUMN IF NOT EXISTS "visitsPerPeriod" INTEGER;
ALTER TABLE "MembershipPlan" ADD COLUMN IF NOT EXISTS "visitPeriod" TEXT NOT NULL DEFAULT 'ROLLING_MONTH';

-- Devices
CREATE TABLE IF NOT EXISTS "MemberDevice" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'ios',
    "name" TEXT,
    "model" TEXT,
    "osVersion" TEXT,
    "appVersion" TEXT,
    "pushToken" TEXT,
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokedReason" TEXT,
    CONSTRAINT "MemberDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MemberDevice_memberId_deviceId_key" ON "MemberDevice"("memberId", "deviceId");
CREATE INDEX IF NOT EXISTS "MemberDevice_memberId_revokedAt_idx" ON "MemberDevice"("memberId", "revokedAt");
CREATE INDEX IF NOT EXISTS "MemberDevice_deviceId_idx" ON "MemberDevice"("deviceId");
DO $$ BEGIN ALTER TABLE "MemberDevice" ADD CONSTRAINT "MemberDevice_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sessions
CREATE TABLE IF NOT EXISTS "MobileSession" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "MobileSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MobileSession_tokenHash_key" ON "MobileSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "MobileSession_memberId_revokedAt_idx" ON "MobileSession"("memberId", "revokedAt");
CREATE INDEX IF NOT EXISTS "MobileSession_deviceId_idx" ON "MobileSession"("deviceId");
DO $$ BEGIN ALTER TABLE "MobileSession" ADD CONSTRAINT "MobileSession_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "MobileSession" ADD CONSTRAINT "MobileSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "MemberDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Transfer requests
CREATE TABLE IF NOT EXISTS "DeviceTransferRequest" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "fromDeviceId" TEXT,
    "toDeviceId" TEXT NOT NULL,
    "toDeviceName" TEXT,
    "toDeviceModel" TEXT,
    "toPlatform" TEXT NOT NULL DEFAULT 'ios',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "memberNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeviceTransferRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DeviceTransferRequest_status_createdAt_idx" ON "DeviceTransferRequest"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "DeviceTransferRequest_memberId_status_idx" ON "DeviceTransferRequest"("memberId", "status");
DO $$ BEGIN ALTER TABLE "DeviceTransferRequest" ADD CONSTRAINT "DeviceTransferRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Events
CREATE TABLE IF NOT EXISTS "Event" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "locationId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "scheduleNote" TEXT,
    "imageUrl" TEXT,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "leagueId" INTEGER,
    "capacity" INTEGER,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Event_locationId_startsAt_idx" ON "Event"("locationId", "startsAt");
CREATE INDEX IF NOT EXISTS "Event_published_startsAt_idx" ON "Event"("published", "startsAt");
DO $$ BEGIN ALTER TABLE "Event" ADD CONSTRAINT "Event_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "EventRsvp" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GOING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventRsvp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EventRsvp_eventId_memberId_key" ON "EventRsvp"("eventId", "memberId");
CREATE INDEX IF NOT EXISTS "EventRsvp_memberId_idx" ON "EventRsvp"("memberId");
DO $$ BEGIN ALTER TABLE "EventRsvp" ADD CONSTRAINT "EventRsvp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "EventRsvp" ADD CONSTRAINT "EventRsvp_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Game improvement
CREATE TABLE IF NOT EXISTS "PracticeProfile" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "handicap" DOUBLE PRECISION,
    "experience" TEXT,
    "sessionsPerWeek" INTEGER,
    "minutesPerSession" INTEGER,
    "handedness" TEXT,
    "goals" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "weakClubs" JSONB NOT NULL,
    "misses" JSONB NOT NULL,
    "survey" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PracticeProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PracticeProfile_memberId_key" ON "PracticeProfile"("memberId");
DO $$ BEGIN ALTER TABLE "PracticeProfile" ADD CONSTRAINT "PracticeProfile_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PracticePlan" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "focusAreas" JSONB NOT NULL,
    "schedule" JSONB NOT NULL,
    "drills" JSONB NOT NULL,
    "basis" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "PracticePlan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PracticePlan_memberId_active_idx" ON "PracticePlan"("memberId", "active");
DO $$ BEGIN ALTER TABLE "PracticePlan" ADD CONSTRAINT "PracticePlan_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PracticeSession" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "locationId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "playedAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER,
    "title" TEXT,
    "notes" TEXT,
    "shotCount" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "fileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PracticeSession_memberId_playedAt_idx" ON "PracticeSession"("memberId", "playedAt");
DO $$ BEGIN ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "SwingShot" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "club" TEXT NOT NULL,
    "ballSpeed" DOUBLE PRECISION,
    "clubSpeed" DOUBLE PRECISION,
    "smashFactor" DOUBLE PRECISION,
    "launchAngle" DOUBLE PRECISION,
    "launchDir" DOUBLE PRECISION,
    "backSpin" DOUBLE PRECISION,
    "sideSpin" DOUBLE PRECISION,
    "spinAxis" DOUBLE PRECISION,
    "carry" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,
    "offline" DOUBLE PRECISION,
    "apex" DOUBLE PRECISION,
    "descentAngle" DOUBLE PRECISION,
    "clubPath" DOUBLE PRECISION,
    "faceAngle" DOUBLE PRECISION,
    "faceToPath" DOUBLE PRECISION,
    "attackAngle" DOUBLE PRECISION,
    "dynamicLoft" DOUBLE PRECISION,
    "shotAt" TIMESTAMP(3),
    "raw" JSONB,
    CONSTRAINT "SwingShot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SwingShot_sessionId_club_idx" ON "SwingShot"("sessionId", "club");
DO $$ BEGIN ALTER TABLE "SwingShot" ADD CONSTRAINT "SwingShot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PracticeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "DrillLog" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "planId" TEXT,
    "drillKey" TEXT NOT NULL,
    "minutes" INTEGER,
    "rating" INTEGER,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DrillLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DrillLog_memberId_completedAt_idx" ON "DrillLog"("memberId", "completedAt");
CREATE INDEX IF NOT EXISTS "DrillLog_planId_idx" ON "DrillLog"("planId");
DO $$ BEGIN ALTER TABLE "DrillLog" ADD CONSTRAINT "DrillLog_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "DrillLog" ADD CONSTRAINT "DrillLog_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PracticePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed known visit allowances for existing plans (Noonan = 3 visits per rolling month)
UPDATE "MembershipPlan" SET "visitsPerPeriod" = 3 WHERE "visitsPerPeriod" IS NULL AND lower("name") LIKE '%noonan%';
