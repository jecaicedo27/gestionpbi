-- Expand sampling point configuration so weekly programming can validate
-- laboratory profile, context, shift and workflow mode per zone.
ALTER TABLE "micro_sampling_points"
    ADD COLUMN "zone_name" TEXT,
    ADD COLUMN "allowed_laboratory_profiles" JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN "allowed_work_contexts" JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN "allowed_shifts" JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN "allowed_workflow_types" JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN "default_laboratory_profile" TEXT,
    ADD COLUMN "default_work_context" TEXT,
    ADD COLUMN "default_shift" TEXT,
    ADD COLUMN "default_workflow_type" TEXT NOT NULL DEFAULT 'EXTERNAL',
    ADD COLUMN "default_assigned_lab" TEXT;

UPDATE "micro_sampling_points"
SET
    "zone_name" = COALESCE("zone_name", "processArea"),
    "allowed_laboratory_profiles" = CASE
        WHEN "allowed_laboratory_profiles" IS NULL OR "allowed_laboratory_profiles" = '[]'::jsonb THEN
            CASE
                WHEN LOWER(COALESCE("processArea", '')) LIKE '%agua%' THEN '["AGUA"]'::jsonb
                WHEN "isEnvironmental" THEN '["AMBIENTE", "SUPERFICIE"]'::jsonb
                ELSE '["PRODUCTO", "LIBERACION"]'::jsonb
            END
        ELSE "allowed_laboratory_profiles"
    END,
    "allowed_work_contexts" = CASE
        WHEN "allowed_work_contexts" IS NULL OR "allowed_work_contexts" = '[]'::jsonb THEN
            CASE
                WHEN "isEnvironmental" THEN '["LAVADO", "LIBERACION"]'::jsonb
                ELSE '["PRODUCCION", "LIBERACION"]'::jsonb
            END
        ELSE "allowed_work_contexts"
    END,
    "allowed_shifts" = CASE
        WHEN "allowed_shifts" IS NULL OR "allowed_shifts" = '[]'::jsonb THEN '["MANANA", "TARDE"]'::jsonb
        ELSE "allowed_shifts"
    END,
    "allowed_workflow_types" = CASE
        WHEN "allowed_workflow_types" IS NULL OR "allowed_workflow_types" = '[]'::jsonb THEN '["EXTERNAL", "INTERNAL"]'::jsonb
        ELSE "allowed_workflow_types"
    END,
    "default_laboratory_profile" = COALESCE(
        "default_laboratory_profile",
        CASE
            WHEN LOWER(COALESCE("processArea", '')) LIKE '%agua%' THEN 'AGUA'
            WHEN "isEnvironmental" THEN 'AMBIENTE'
            ELSE 'PRODUCTO'
        END
    ),
    "default_work_context" = COALESCE(
        "default_work_context",
        CASE
            WHEN "isEnvironmental" THEN 'LAVADO'
            ELSE 'PRODUCCION'
        END
    ),
    "default_shift" = COALESCE("default_shift", 'MANANA'),
    "default_assigned_lab" = COALESCE("default_assigned_lab", 'Biotrends Laboratorios');

-- Weekly programming entries by real date.
CREATE TABLE "micro_schedule_entries" (
    "id" TEXT NOT NULL,
    "sampling_point_id" TEXT NOT NULL,
    "planned_date" TIMESTAMP(3) NOT NULL,
    "planned_time" TEXT,
    "shift" TEXT NOT NULL,
    "work_context" TEXT NOT NULL,
    "workflow_type" TEXT NOT NULL DEFAULT 'EXTERNAL',
    "laboratory_profile" TEXT NOT NULL,
    "assigned_lab" TEXT,
    "zone_name" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "sample_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "micro_schedule_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "micro_schedule_entries_sample_id_key" ON "micro_schedule_entries"("sample_id");
CREATE UNIQUE INDEX "micro_schedule_entries_point_date_shift_context_profile_key"
    ON "micro_schedule_entries"("sampling_point_id", "planned_date", "shift", "work_context", "laboratory_profile");
CREATE INDEX "micro_schedule_entries_planned_date_idx" ON "micro_schedule_entries"("planned_date");
CREATE INDEX "micro_schedule_entries_status_idx" ON "micro_schedule_entries"("status");
CREATE INDEX "micro_schedule_entries_sampling_point_id_planned_date_idx" ON "micro_schedule_entries"("sampling_point_id", "planned_date");

ALTER TABLE "micro_schedule_entries"
    ADD CONSTRAINT "micro_schedule_entries_sampling_point_id_fkey"
    FOREIGN KEY ("sampling_point_id") REFERENCES "micro_sampling_points"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "micro_schedule_entries"
    ADD CONSTRAINT "micro_schedule_entries_sample_id_fkey"
    FOREIGN KEY ("sample_id") REFERENCES "micro_samples"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "micro_schedule_entries"
    ADD CONSTRAINT "micro_schedule_entries_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Extend micro samples to distinguish external vs internal workflow and keep
-- final report state for plant lab execution.
ALTER TABLE "micro_samples"
    ADD COLUMN "workflow_type" TEXT NOT NULL DEFAULT 'EXTERNAL',
    ADD COLUMN "work_context" TEXT,
    ADD COLUMN "shift" TEXT,
    ADD COLUMN "zone_name" TEXT,
    ADD COLUMN "laboratory_profile" TEXT,
    ADD COLUMN "started_at" TIMESTAMP(3),
    ADD COLUMN "completed_at" TIMESTAMP(3),
    ADD COLUMN "closed_at" TIMESTAMP(3),
    ADD COLUMN "final_conclusion" TEXT,
    ADD COLUMN "final_report_data" JSONB;

UPDATE "micro_samples" ms
SET
    "workflow_type" = COALESCE(ms."workflow_type", 'EXTERNAL'),
    "zone_name" = COALESCE(ms."zone_name", msp."zone_name", msp."processArea"),
    "laboratory_profile" = COALESCE(
        ms."laboratory_profile",
        CASE
            WHEN LOWER(COALESCE(msp."processArea", '')) LIKE '%agua%' THEN 'AGUA'
            WHEN msp."isEnvironmental" THEN 'AMBIENTE'
            ELSE 'PRODUCTO'
        END
    ),
    "work_context" = COALESCE(
        ms."work_context",
        CASE
            WHEN msp."isEnvironmental" THEN 'LAVADO'
            ELSE 'PRODUCCION'
        END
    ),
    "shift" = COALESCE(ms."shift", 'MANANA'),
    "started_at" = COALESCE(ms."started_at", ms."takenAt"),
    "completed_at" = CASE
        WHEN ms."status" = 'COMPLETED' AND ms."completed_at" IS NULL THEN COALESCE(ms."updatedAt", ms."createdAt")
        ELSE ms."completed_at"
    END
FROM "micro_sampling_points" msp
WHERE msp."id" = ms."samplingPointId";

CREATE INDEX "micro_samples_workflow_type_idx" ON "micro_samples"("workflow_type");
CREATE INDEX "micro_samples_closed_at_idx" ON "micro_samples"("closed_at");

-- Daily internal logbook for the plant laboratory workflow.
CREATE TABLE "micro_internal_logs" (
    "id" TEXT NOT NULL,
    "sample_id" TEXT NOT NULL,
    "log_date" TIMESTAMP(3) NOT NULL,
    "day_number" INTEGER,
    "observations" TEXT,
    "readings" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "micro_internal_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "micro_internal_logs_sample_id_log_date_key" ON "micro_internal_logs"("sample_id", "log_date");
CREATE INDEX "micro_internal_logs_sample_id_idx" ON "micro_internal_logs"("sample_id");
CREATE INDEX "micro_internal_logs_log_date_idx" ON "micro_internal_logs"("log_date");

ALTER TABLE "micro_internal_logs"
    ADD CONSTRAINT "micro_internal_logs_sample_id_fkey"
    FOREIGN KEY ("sample_id") REFERENCES "micro_samples"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "micro_internal_logs"
    ADD CONSTRAINT "micro_internal_logs_recorded_by_id_fkey"
    FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
