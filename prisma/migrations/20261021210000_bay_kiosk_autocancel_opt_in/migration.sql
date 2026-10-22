-- Kiosk auto-cancel is opt-in. The unlock prompt simply dismisses after the
-- unlock window unless an admin explicitly enables auto-cancel for a location.
ALTER TABLE "Location" ALTER COLUMN "bayAppAutoCancelOnTimeout" SET DEFAULT false;

-- Only reset locations that have never turned the kiosk on; a location that is
-- already live with the kiosk keeps whatever it chose.
UPDATE "Location"
SET "bayAppAutoCancelOnTimeout" = false
WHERE "bayAppEnabled" = false;
