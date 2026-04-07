-- ============================================================
-- Normalization Fase 3 y 7 — 2026-03-30
-- Fase 3: Agregar driver_id FK en orders → drivers
-- Fase 7: Eliminar stage1-4AssemblyId y lotNumbers de production_batches (0 rows cada uno)
-- ============================================================

-- Fase 3: FK orders → drivers
ALTER TABLE "orders" ADD COLUMN "driver_id" TEXT;
ALTER TABLE "orders" ADD CONSTRAINT "orders_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Fase 7: Drop legacy batch fields (all NULL, no code references)
ALTER TABLE "production_batches"
  DROP COLUMN IF EXISTS "lotNumbers",
  DROP COLUMN IF EXISTS "stage1AssemblyId",
  DROP COLUMN IF EXISTS "stage2AssemblyId",
  DROP COLUMN IF EXISTS "stage3AssemblyId",
  DROP COLUMN IF EXISTS "stage4AssemblyId";
