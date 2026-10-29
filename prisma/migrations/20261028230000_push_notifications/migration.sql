-- Push notifications: per-device opt-in state + org-level preference.
ALTER TABLE "MemberDevice" ADD COLUMN IF NOT EXISTS "pushEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MemberDevice" ADD COLUMN IF NOT EXISTS "pushPermission" TEXT;
ALTER TABLE "MemberDevice" ADD COLUMN IF NOT EXISTS "pushUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "pushEnabled" BOOLEAN NOT NULL DEFAULT true;
