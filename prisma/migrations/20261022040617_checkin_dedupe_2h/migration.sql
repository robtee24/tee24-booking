-- AlterTable
ALTER TABLE "Location" ALTER COLUMN "attendanceDedupeHours" SET DEFAULT 2;


-- Existing locations: use the 2-hour window too
UPDATE "Location" SET "attendanceDedupeHours" = 2 WHERE "attendanceDedupeHours" = 8;
