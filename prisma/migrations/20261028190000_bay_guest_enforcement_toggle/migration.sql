-- Per-location switch for the kiosk's too-many-players enforcement (GSPro player-count
-- reading, unauthorized-guest charge, admin alerts). Off by default: the kiosk then only
-- does the reservation heads-up and phone unlock.
ALTER TABLE "Location" ADD COLUMN "bayAppGuestEnforcement" BOOLEAN NOT NULL DEFAULT false;
