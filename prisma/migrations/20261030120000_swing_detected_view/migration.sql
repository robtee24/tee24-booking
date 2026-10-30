-- Camera angle swinglab reads off the clip right after upload (face_on | down_the_line | unknown).
ALTER TABLE "SwingAnalysis" ADD COLUMN IF NOT EXISTS "detectedView" TEXT;
