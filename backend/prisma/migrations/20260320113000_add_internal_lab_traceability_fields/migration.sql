ALTER TABLE "micro_samples"
    ADD COLUMN "received_at" TIMESTAMP(3),
    ADD COLUMN "results_captured_at" TIMESTAMP(3),
    ADD COLUMN "reviewed_at" TIMESTAMP(3),
    ADD COLUMN "acceptance_data" JSONB,
    ADD COLUMN "sample_type_data" JSONB,
    ADD COLUMN "analysis_execution_data" JSONB,
    ADD COLUMN "technical_review_data" JSONB,
    ADD COLUMN "approval_data" JSONB,
    ADD COLUMN "deviation_data" JSONB;
