ALTER TABLE "pqr"
ADD COLUMN "reportedByName" TEXT,
ADD COLUMN "reportedByNameNormalized" TEXT;

CREATE INDEX "pqr_userId_reportedByNameNormalized_idx" ON "pqr"("userId", "reportedByNameNormalized");
