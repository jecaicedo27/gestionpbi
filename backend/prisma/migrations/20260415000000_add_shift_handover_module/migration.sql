-- Migration: add_shift_handover_module
-- Creates tables for the Shift Handover (Relevo de Turno) module.
-- Purely additive: CREATE TABLE, CREATE INDEX, INSERT only. No DROP/ALTER/RENAME.

-- =====================================================
-- 1. Enum for handover status
-- =====================================================

CREATE TYPE "HandoverStatus" AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'DELIVERED',
  'RECEIVED',
  'WITH_INCIDENT',
  'VALIDATED'
);

-- =====================================================
-- 2. Main handover record — one per area × transition × date
-- =====================================================

CREATE TABLE "shift_handover_records" (
  "id"                      TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "week_id"                 TEXT NOT NULL,
  "published_at_snapshot"   TIMESTAMP(3),
  "area"                    TEXT NOT NULL,
  "operational_date"        DATE NOT NULL,
  "outgoing_shift"          TEXT NOT NULL,
  "incoming_shift"          TEXT NOT NULL,

  -- Outgoing leader authorization
  "outgoing_leader_id"      TEXT,
  "outgoing_leader_at"      TIMESTAMP(3),

  -- Incoming leader acceptance
  "incoming_leader_id"      TEXT,
  "incoming_leader_at"      TIMESTAMP(3),

  -- Participant snapshots from published schedule
  "outgoing_participants"   JSONB,
  "incoming_participants"   JSONB,

  -- Checklist and notes (filled by outgoing leader)
  "checklist"               JSONB,
  "pending_tasks"           TEXT,
  "incidents"               TEXT,
  "observations"            TEXT,

  -- Supervisor validation (optional)
  "supervisor_id"           TEXT,
  "supervisor_at"           TIMESTAMP(3),

  -- Status and state machine
  "status"                  "HandoverStatus" NOT NULL DEFAULT 'PENDING',
  "rejection_reason"        TEXT,

  -- Timing
  "grace_deadline"          TIMESTAMP(3),
  "all_signed_at"           TIMESTAMP(3),

  -- Emergency force-complete
  "forced_complete_by"      TEXT,
  "forced_complete_at"      TIMESTAMP(3),
  "forced_reason"           TEXT,

  -- Audit
  "audit_log"               JSONB,
  "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shift_handover_records_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "shift_handover_records"
  ADD CONSTRAINT "shift_handover_records_week_id_fkey"
  FOREIGN KEY ("week_id") REFERENCES "shift_weeks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shift_handover_records"
  ADD CONSTRAINT "shift_handover_records_outgoing_leader_id_fkey"
  FOREIGN KEY ("outgoing_leader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shift_handover_records"
  ADD CONSTRAINT "shift_handover_records_incoming_leader_id_fkey"
  FOREIGN KEY ("incoming_leader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shift_handover_records"
  ADD CONSTRAINT "shift_handover_records_supervisor_id_fkey"
  FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shift_handover_records"
  ADD CONSTRAINT "shift_handover_records_forced_complete_by_fkey"
  FOREIGN KEY ("forced_complete_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Unique: one handover per area + shift transition + date
CREATE UNIQUE INDEX "shift_handover_records_week_date_area_shift_key"
  ON "shift_handover_records"("week_id", "operational_date", "area", "outgoing_shift");

CREATE INDEX "shift_handover_records_date_area_idx"
  ON "shift_handover_records"("operational_date", "area");

CREATE INDEX "shift_handover_records_status_idx"
  ON "shift_handover_records"("status");

CREATE INDEX "shift_handover_records_outgoing_leader_idx"
  ON "shift_handover_records"("outgoing_leader_id");

CREATE INDEX "shift_handover_records_incoming_leader_idx"
  ON "shift_handover_records"("incoming_leader_id");

-- =====================================================
-- 3. Individual operator signatures
-- =====================================================

CREATE TABLE "shift_handover_signatures" (
  "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "handover_id"     TEXT NOT NULL,
  "employee_id"     TEXT NOT NULL,
  "user_id"         TEXT NOT NULL,
  "signed_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip_address"      TEXT,
  "user_agent"      TEXT,
  "notes"           TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shift_handover_signatures_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "shift_handover_signatures"
  ADD CONSTRAINT "shift_handover_signatures_handover_id_fkey"
  FOREIGN KEY ("handover_id") REFERENCES "shift_handover_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_handover_signatures"
  ADD CONSTRAINT "shift_handover_signatures_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "shift_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_handover_signatures"
  ADD CONSTRAINT "shift_handover_signatures_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Each operator signs only once per handover
CREATE UNIQUE INDEX "shift_handover_signatures_handover_user_key"
  ON "shift_handover_signatures"("handover_id", "user_id");

CREATE INDEX "shift_handover_signatures_handover_idx"
  ON "shift_handover_signatures"("handover_id");

-- =====================================================
-- 4. Checklist templates (administrable per area)
-- =====================================================

CREATE TABLE "shift_handover_checklists" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "area"        TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "field_type"  TEXT NOT NULL DEFAULT 'boolean',
  "sort_order"  INT NOT NULL DEFAULT 0,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shift_handover_checklists_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shift_handover_checklists_area_active_idx"
  ON "shift_handover_checklists"("area", "active");

-- =====================================================
-- 5. Seed default checklists per area
-- =====================================================

INSERT INTO "shift_handover_checklists" ("id", "area", "label", "field_type", "sort_order") VALUES
  (gen_random_uuid()::text, 'PRODUCCION', '¿Máquina de esferificación limpia y operativa?', 'boolean', 1),
  (gen_random_uuid()::text, 'PRODUCCION', '¿Tanques vaciados y enjuagados?', 'boolean', 2),
  (gen_random_uuid()::text, 'PRODUCCION', '¿Piso y drenajes limpios?', 'boolean', 3),
  (gen_random_uuid()::text, 'PRODUCCION', '¿Herramientas organizadas y completas?', 'boolean', 4),
  (gen_random_uuid()::text, 'PRODUCCION', '¿Insumos suficientes para el próximo turno?', 'boolean', 5),
  (gen_random_uuid()::text, 'PRODUCCION', 'Lotes producidos durante el turno', 'text', 6),
  (gen_random_uuid()::text, 'PRODUCCION', 'Novedades / problemas de máquina', 'text', 7),

  (gen_random_uuid()::text, 'SIROPES', '¿Equipos de cocción limpios?', 'boolean', 1),
  (gen_random_uuid()::text, 'SIROPES', '¿Materias primas almacenadas correctamente?', 'boolean', 2),
  (gen_random_uuid()::text, 'SIROPES', '¿Área de pesaje limpia y ordenada?', 'boolean', 3),
  (gen_random_uuid()::text, 'SIROPES', '¿Instrumentos de medición calibrados?', 'boolean', 4),
  (gen_random_uuid()::text, 'SIROPES', 'Lotes de sirope preparados', 'text', 5),
  (gen_random_uuid()::text, 'SIROPES', 'Novedades / problemas de equipo', 'text', 6),

  (gen_random_uuid()::text, 'EMPAQUE', '¿Máquinas de empaque limpias y operativas?', 'boolean', 1),
  (gen_random_uuid()::text, 'EMPAQUE', '¿Material de empaque disponible y organizado?', 'boolean', 2),
  (gen_random_uuid()::text, 'EMPAQUE', '¿Selladora funcionando correctamente?', 'boolean', 3),
  (gen_random_uuid()::text, 'EMPAQUE', '¿Área de trabajo limpia y despejada?', 'boolean', 4),
  (gen_random_uuid()::text, 'EMPAQUE', '¿Producto terminado rotulado y ubicado?', 'boolean', 5),
  (gen_random_uuid()::text, 'EMPAQUE', 'Lotes empacados durante el turno', 'text', 6),
  (gen_random_uuid()::text, 'EMPAQUE', 'Novedades / problemas de máquina', 'text', 7)
ON CONFLICT DO NOTHING;

-- =====================================================
-- 6. Feature flag in system_settings
-- =====================================================

INSERT INTO "system_settings" ("id", "key", "value", "description", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'SHIFT_HANDOVER_ENABLED',
  'true',
  'Habilita el módulo de Relevo de Turno (shift handover)',
  NOW()
) ON CONFLICT ("key") DO NOTHING;
