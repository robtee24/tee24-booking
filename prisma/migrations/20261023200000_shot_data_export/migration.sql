-- GSPro shot-data exports captured at the bay kiosk, pulled into the member app on "Sync latest data".
CREATE TABLE IF NOT EXISTS "ShotDataExport" (
  "id"         TEXT NOT NULL,
  "memberId"   TEXT,
  "locationId" TEXT NOT NULL,
  "bayNumber"  INTEGER NOT NULL,
  "bookingId"  TEXT,
  "deviceId"   TEXT,
  "phone"      TEXT,
  "fileName"   TEXT NOT NULL,
  "csvText"    TEXT NOT NULL,
  "byteSize"   INTEGER NOT NULL DEFAULT 0,
  "shotCount"  INTEGER NOT NULL DEFAULT 0,
  "playedAt"   TIMESTAMP(3),
  "delivery"   TEXT NOT NULL DEFAULT 'APP',
  "emailTo"    TEXT,
  "emailedAt"  TIMESTAMP(3),
  "status"     TEXT NOT NULL DEFAULT 'PENDING',
  "sessionId"  TEXT,
  "error"      TEXT,
  "importedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShotDataExport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShotDataExport_sessionId_key" ON "ShotDataExport"("sessionId");
CREATE INDEX IF NOT EXISTS "ShotDataExport_memberId_status_createdAt_idx" ON "ShotDataExport"("memberId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ShotDataExport_phone_status_idx" ON "ShotDataExport"("phone", "status");
CREATE INDEX IF NOT EXISTS "ShotDataExport_locationId_createdAt_idx" ON "ShotDataExport"("locationId", "createdAt");

ALTER TABLE "ShotDataExport" ADD CONSTRAINT "ShotDataExport_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShotDataExport" ADD CONSTRAINT "ShotDataExport_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "PracticeSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
