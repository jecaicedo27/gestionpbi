-- Migration: add_attendance_module
-- Adds attendance tracking, face enrollment, and presence management to gestionpbi

-- =====================================================
-- 1. New enums
-- =====================================================

CREATE TYPE "AttendanceType" AS ENUM ('ENTRY', 'EXIT');
CREATE TYPE "AttendanceSubtype" AS ENUM ('BREAK', 'LUNCH', 'MEDICAL', 'PERSONAL', 'FINAL');
CREATE TYPE "AttendanceSource" AS ENUM ('KIOSK', 'MANUAL');

-- =====================================================
-- 2. New value on UserRole enum
-- =====================================================

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'RECURSOS_HUMANOS';

-- =====================================================
-- 3. New columns on shift_employees
-- =====================================================

ALTER TABLE "shift_employees"
  ADD COLUMN IF NOT EXISTS "cedula"          TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS "face_descriptor" JSONB,
  ADD COLUMN IF NOT EXISTS "photo_url"       TEXT,
  ADD COLUMN IF NOT EXISTS "pin"             TEXT,
  ADD COLUMN IF NOT EXISTS "is_in_plant"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "last_entry_at"   TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "shift_employees_cedula_idx"     ON "shift_employees"("cedula");
CREATE INDEX IF NOT EXISTS "shift_employees_is_in_plant_idx" ON "shift_employees"("is_in_plant");

-- =====================================================
-- 4. Shift schedule definitions (horas por tipo de turno)
-- =====================================================

CREATE TABLE "shift_schedule_definitions" (
  "id"               TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name"             TEXT NOT NULL,
  "code"             TEXT NOT NULL,
  "weekday_start"    TEXT NOT NULL,
  "weekday_end"      TEXT NOT NULL,
  "saturday_start"   TEXT,
  "saturday_end"     TEXT,
  "sunday_start"     TEXT,
  "sunday_end"       TEXT,
  "crosses_midnight" BOOLEAN NOT NULL DEFAULT false,
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shift_schedule_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shift_schedule_definitions_name_key" ON "shift_schedule_definitions"("name");
CREATE UNIQUE INDEX "shift_schedule_definitions_code_key" ON "shift_schedule_definitions"("code");

-- Seed inicial de turnos
INSERT INTO "shift_schedule_definitions" ("name", "code", "weekday_start", "weekday_end", "saturday_start", "saturday_end", "crosses_midnight", "active")
VALUES
  ('Oficina',  'OFICINA', '08:00', '17:00', '08:00', '12:00', false, true),
  ('Mañana',   'MANANA',  '06:00', '14:00', '06:00', '14:00', false, true),
  ('Tarde',    'TARDE',   '14:00', '22:00', '14:00', '22:00', false, true),
  ('Noche',    'NOCHE',   '22:00', '06:00', NULL,    NULL,    true,  true)
ON CONFLICT DO NOTHING;

-- =====================================================
-- 5. Attendance records
-- =====================================================

CREATE TABLE "attendance_records" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "employee_id" TEXT NOT NULL,
  "type"        "AttendanceType" NOT NULL,
  "subtype"     "AttendanceSubtype",
  "timestamp"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "latitude"    DOUBLE PRECISION,
  "longitude"   DOUBLE PRECISION,
  "accuracy"    DOUBLE PRECISION,
  "photo_path"  TEXT,
  "verified"    BOOLEAN NOT NULL DEFAULT false,
  "source"      "AttendanceSource" NOT NULL DEFAULT 'KIOSK',
  "notes"       TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_employee_id_fkey"
  FOREIGN KEY ("employee_id")
  REFERENCES "shift_employees"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "attendance_records_employee_id_timestamp_idx" ON "attendance_records"("employee_id", "timestamp");
CREATE INDEX "attendance_records_timestamp_idx"             ON "attendance_records"("timestamp");
