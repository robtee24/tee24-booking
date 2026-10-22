-- Per-location Square account (secrets encrypted at rest by the app).
ALTER TABLE "Location"
  ADD COLUMN "squareEnv" TEXT,
  ADD COLUMN "squareApplicationId" TEXT,
  ADD COLUMN "squareLocationId" TEXT,
  ADD COLUMN "squareAccessTokenEnc" TEXT,
  ADD COLUMN "squareWebhookSignatureKeyEnc" TEXT,
  ADD COLUMN "squareMerchantName" TEXT,
  ADD COLUMN "squareConnectedAt" TIMESTAMP(3);
