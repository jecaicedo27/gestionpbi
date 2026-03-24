-- CreateTable
CREATE TABLE "micro_sample_attachments" (
    "id" TEXT NOT NULL,
    "sample_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "stored_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "micro_sample_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "micro_sample_attachments_sample_id_idx" ON "micro_sample_attachments"("sample_id");

-- CreateIndex
CREATE INDEX "micro_sample_attachments_sample_id_category_idx" ON "micro_sample_attachments"("sample_id", "category");

-- AddForeignKey
ALTER TABLE "micro_sample_attachments"
ADD CONSTRAINT "micro_sample_attachments_sample_id_fkey"
FOREIGN KEY ("sample_id") REFERENCES "micro_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing lab reports so historical samples keep their document metadata.
INSERT INTO "micro_sample_attachments" (
    "id",
    "sample_id",
    "category",
    "original_name",
    "stored_name",
    "mime_type",
    "size_bytes",
    "url",
    "created_at"
)
SELECT
    'msa_' || md5(ms."id" || ms."reportUrl" || COALESCE(ms."updatedAt"::text, ms."createdAt"::text)),
    ms."id",
    'LAB_REPORT',
    regexp_replace(ms."reportUrl", '^.*/', ''),
    regexp_replace(ms."reportUrl", '^.*/', ''),
    'application/pdf',
    NULL,
    ms."reportUrl",
    ms."createdAt"
FROM "micro_samples" ms
WHERE ms."reportUrl" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM "micro_sample_attachments" msa
      WHERE msa."sample_id" = ms."id"
        AND msa."url" = ms."reportUrl"
  );
