ALTER TABLE "micro_schedule_entries"
    ADD COLUMN "requested_parameter_ids" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "micro_samples"
    ADD COLUMN "requested_parameter_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN "dispatch_at" TIMESTAMP(3),
    ADD COLUMN "dispatch_reference" TEXT,
    ADD COLUMN "dispatch_observations" TEXT,
    ADD COLUMN "results_received_at" TIMESTAMP(3),
    ADD COLUMN "production_context_data" JSONB;
