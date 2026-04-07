-- ============================================================
-- Normalización Fase 4 y 8 — 2026-03-30
-- Fase 8: Eliminar campos legacy de fotos en Reception (0 rows con datos)
-- Fase 4: Crear tabla pending_box_entries (normaliza entries Json de PendingBox)
--         + backfill desde JSON + DROP COLUMN entries
-- Todo en orden correcto para mantener integridad.
-- ============================================================

-- Fase 4: Crear tabla normalizada PRIMERO
CREATE TABLE "pending_box_entries" (
    "id" TEXT NOT NULL,
    "box_id" TEXT NOT NULL,
    "lot" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "expiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pending_box_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pending_box_entries_box_id_idx" ON "pending_box_entries"("box_id");
ALTER TABLE "pending_box_entries"
    ADD CONSTRAINT "pending_box_entries_box_id_fkey"
    FOREIGN KEY ("box_id") REFERENCES "pending_boxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fase 4: Backfill desde JSON usando gen_random_uuid() y jsonb_array_elements
INSERT INTO "pending_box_entries" ("id", "box_id", "lot", "qty", "expiry", "createdAt")
SELECT
    gen_random_uuid()::text,
    pb.id,
    (entry->>'lot')::text,
    (entry->>'qty')::integer,
    CASE WHEN entry->>'expiry' IS NOT NULL AND entry->>'expiry' != ''
         THEN (entry->>'expiry')::timestamp
         ELSE NULL
    END,
    NOW()
FROM "pending_boxes" pb,
     jsonb_array_elements(pb.entries) AS entry
WHERE pb.entries IS NOT NULL;

-- Fase 4: Ahora que los datos están migrados, eliminar columna JSON
ALTER TABLE "pending_boxes" DROP COLUMN IF EXISTS "entries";

-- Fase 8: Eliminar campos legacy de fotos (confirmado 0 filas con datos)
ALTER TABLE "receptions"
    DROP COLUMN IF EXISTS "photoProductUrl",
    DROP COLUMN IF EXISTS "photoInvoiceUrl";
