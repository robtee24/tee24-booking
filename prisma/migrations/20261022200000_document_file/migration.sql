-- Signed document bytes (PDF the member actually signed), one per assignment.
CREATE TABLE "DocumentFile" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "source" TEXT,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentFile_assignmentId_key" ON "DocumentFile"("assignmentId");

ALTER TABLE "DocumentFile" ADD CONSTRAINT "DocumentFile_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "DocumentAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
