ALTER TABLE "micro_schedule_entries"
    ADD COLUMN "status_reason" TEXT,
    ADD COLUMN "status_history" JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN "rescheduled_from_id" TEXT;

CREATE INDEX "micro_schedule_entries_rescheduled_from_id_idx"
    ON "micro_schedule_entries"("rescheduled_from_id");

ALTER TABLE "micro_schedule_entries"
    ADD CONSTRAINT "micro_schedule_entries_rescheduled_from_id_fkey"
    FOREIGN KEY ("rescheduled_from_id") REFERENCES "micro_schedule_entries"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
