-- ============================================================
-- Normalization Fase 1, 2, 6 — 2026-03-30
-- Fase 1: Drop empty SystemConfig table (0 rows, no code refs)
-- Fase 2: Convert assembly_notes.status from String to enum
-- Fase 6: Formalize FK lot_consumptions → assembly_notes
-- ============================================================

-- Fase 2: Create enum type
CREATE TYPE "AssemblyNoteStatus" AS ENUM ('PENDING', 'EXECUTING', 'COMPLETED', 'FAILED');

-- Fase 6: Drop old untyped index (column rename coming)
DROP INDEX IF EXISTS "lot_consumptions_assemblyNoteId_idx";

-- Fase 2: Convert status column to enum (existing values PENDING/EXECUTING/COMPLETED match)
ALTER TABLE "assembly_notes" DROP COLUMN "status";
ALTER TABLE "assembly_notes" ADD COLUMN "status" "AssemblyNoteStatus" NOT NULL DEFAULT 'PENDING';

-- Fase 6: Rename assemblyNoteId → assembly_note_id (now properly mapped)
ALTER TABLE "lot_consumptions" DROP COLUMN "assemblyNoteId";
ALTER TABLE "lot_consumptions" ADD COLUMN "assembly_note_id" TEXT;

-- Fase 1: Drop empty SystemConfig table
DROP TABLE IF EXISTS "system_config";

-- Fase 2: Recreate index on new enum column
CREATE INDEX "assembly_notes_status_idx" ON "assembly_notes"("status");

-- Fase 6: Recreate index with correct column name
CREATE INDEX "lot_consumptions_assembly_note_id_idx" ON "lot_consumptions"("assembly_note_id");

-- Fase 6: Add FK constraint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_assembly_note_id_fkey"
  FOREIGN KEY ("assembly_note_id") REFERENCES "assembly_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
