-- Bay kiosk support
-- * LaunchMonitor enum + Bay.launchMonitor / Bay.setupNotes (bay-specific help in the kiosk)
-- * BayAppRegistration heartbeat columns (online indicator in admin)
-- * Location.bayAppWarningMinutes default -> 10 (matches "10 minutes before" spec)

DO $$ BEGIN
  CREATE TYPE "LaunchMonitor" AS ENUM ('IDRA', 'SKYTRAK', 'PROTEE_VX', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Bay" ADD COLUMN IF NOT EXISTS "launchMonitor" "LaunchMonitor" NOT NULL DEFAULT 'IDRA';
ALTER TABLE "Bay" ADD COLUMN IF NOT EXISTS "setupNotes" TEXT;

ALTER TABLE "BayAppRegistration" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "BayAppRegistration" ADD COLUMN IF NOT EXISTS "appVersion" TEXT;
ALTER TABLE "BayAppRegistration" ADD COLUMN IF NOT EXISTS "hostname" TEXT;

ALTER TABLE "Location" ALTER COLUMN "bayAppWarningMinutes" SET DEFAULT 10;
