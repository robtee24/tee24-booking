-- Video swing analysis (swinglab) results
CREATE TABLE IF NOT EXISTS "SwingAnalysis" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "sessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "jobId" TEXT,
    "handedness" TEXT NOT NULL DEFAULT 'RH',
    "view" TEXT NOT NULL DEFAULT 'auto',
    "club" TEXT,
    "title" TEXT,
    "notes" TEXT,
    "report" JSONB,
    "flags" JSONB,
    "error" TEXT,
    "seconds" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwingAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SwingAnalysis_sessionId_key" ON "SwingAnalysis"("sessionId");
CREATE INDEX IF NOT EXISTS "SwingAnalysis_memberId_createdAt_idx" ON "SwingAnalysis"("memberId", "createdAt");
CREATE INDEX IF NOT EXISTS "SwingAnalysis_jobId_idx" ON "SwingAnalysis"("jobId");

DO $$ BEGIN
    ALTER TABLE "SwingAnalysis" ADD CONSTRAINT "SwingAnalysis_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "SwingAnalysis" ADD CONSTRAINT "SwingAnalysis_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PracticeSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
