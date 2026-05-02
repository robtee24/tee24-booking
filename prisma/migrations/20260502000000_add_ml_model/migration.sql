-- Churn risk v2 model storage
CREATE TABLE "MlModel" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "trainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MlModel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MlModel_version_key" ON "MlModel"("version");
CREATE INDEX "MlModel_kind_active_idx" ON "MlModel"("kind", "active");
