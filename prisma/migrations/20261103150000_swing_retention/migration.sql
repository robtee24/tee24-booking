-- Swing Lab media retention
ALTER TABLE "SwingAnalysis" ADD COLUMN IF NOT EXISTS "lastOpenedAt" TIMESTAMP(3);
ALTER TABLE "SwingAnalysis" ADD COLUMN IF NOT EXISTS "clipPurgedAt" TIMESTAMP(3);
ALTER TABLE "SwingAnalysis" ADD COLUMN IF NOT EXISTS "mediaPurgedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "SwingAnalysis_status_completedAt_idx" ON "SwingAnalysis"("status", "completedAt");
