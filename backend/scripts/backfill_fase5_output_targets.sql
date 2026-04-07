-- ============================================================
-- FASE 5: Backfill batch_output_targets con resultados reales
-- Columnas reales (mix camelCase legacy + snake_case new):
--   batchId, productId, plannedUnits  (legacy camelCase)
--   actual_units, approved_units, defective_units  (nuevas snake_case)
-- ============================================================

BEGIN;

-- ── 1. LIQUIPOPS: Poblar actual_units desde notas CONTEO ──────────────────
-- La nota CONTEO tiene: process_parameters.conteo = { "PRODUCT NAME": { actual, productId } }
-- assembly_notes usa snake_case: production_batch_id, product_id, process_parameters, status

UPDATE batch_output_targets bot
SET actual_units = subq.actual_val
FROM (
    SELECT
        an.production_batch_id                AS batch_id,
        (kv.value->>'productId')              AS prod_id,
        (kv.value->>'actual')::int            AS actual_val
    FROM assembly_notes an
    JOIN process_types pt ON pt.id = an.process_type_id
    CROSS JOIN LATERAL jsonb_each(
        (an.process_parameters->'conteo')
    ) AS kv(key, value)
    WHERE pt.code = 'CONTEO'
      AND an.status = 'COMPLETED'
      AND an.process_parameters ? 'conteo'
      AND (kv.value->>'productId') IS NOT NULL
      AND (kv.value->>'actual') IS NOT NULL
      AND (kv.value->>'actual')::int > 0
) subq
WHERE bot."batchId"   = subq.batch_id
  AND bot."productId" = subq.prod_id
  AND bot.actual_units = 0;

-- ── 2. LIQUIPOPS: Poblar approved_units y defective_units desde EMPAQUE COMPLETED ──
-- process_parameters.empaque = { approved_qty, defective_qty }
-- product_id del target = process_parameters.product_id OR note.product_id

UPDATE batch_output_targets bot
SET
    approved_units  = subq.approved_val,
    defective_units = subq.defective_val
FROM (
    SELECT
        an.production_batch_id AS batch_id,
        COALESCE(
            (an.process_parameters->>'product_id'),
            an.product_id
        ) AS prod_id,
        (an.process_parameters->'empaque'->>'approved_qty')::int AS approved_val,
        COALESCE(
            (an.process_parameters->'empaque'->>'defective_qty')::int,
            0
        ) AS defective_val
    FROM assembly_notes an
    JOIN process_types pt ON pt.id = an.process_type_id
    WHERE pt.code = 'EMPAQUE'
      AND an.status = 'COMPLETED'
      AND an.process_parameters ? 'empaque'
      AND (an.process_parameters->'empaque'->>'approved_qty') IS NOT NULL
      AND (an.process_parameters->'empaque'->>'approved_qty')::int >= 0
) subq
WHERE bot."batchId"   = subq.batch_id
  AND bot."productId" = subq.prod_id
  AND (bot.approved_units = 0 AND bot.defective_units = 0);

-- ── 3. Fallback: EMPAQUE PENDING con datos parciales ya capturados ────────
-- Algunas notas quedaron en PENDING pero el wizard ya registró approved_qty.

UPDATE batch_output_targets bot
SET
    approved_units  = subq.approved_val,
    defective_units = subq.defective_val
FROM (
    SELECT
        an.production_batch_id AS batch_id,
        COALESCE(
            (an.process_parameters->>'product_id'),
            an.product_id
        ) AS prod_id,
        (an.process_parameters->'empaque'->>'approved_qty')::int AS approved_val,
        COALESCE(
            (an.process_parameters->'empaque'->>'defective_qty')::int,
            0
        ) AS defective_val
    FROM assembly_notes an
    JOIN process_types pt ON pt.id = an.process_type_id
    WHERE pt.code = 'EMPAQUE'
      AND an.status IN ('PENDING', 'EXECUTING')
      AND an.process_parameters ? 'empaque'
      AND (an.process_parameters->'empaque'->>'approved_qty') IS NOT NULL
      AND (an.process_parameters->'empaque'->>'approved_qty')::int > 0
) subq
WHERE bot."batchId"   = subq.batch_id
  AND bot."productId" = subq.prod_id
  AND (bot.approved_units = 0 AND bot.defective_units = 0);

COMMIT;

-- ── Verificación post-backfill ──────────────────────────────────────────────
SELECT
    COUNT(*)                                                        AS total_targets,
    COUNT(*) FILTER (WHERE actual_units   > 0)                     AS with_actual,
    COUNT(*) FILTER (WHERE approved_units > 0)                     AS with_approved,
    COUNT(*) FILTER (WHERE defective_units > 0)                    AS with_defective,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE actual_units > 0)
        / NULLIF(COUNT(*),0), 1
    )                                                               AS pct_actual_filled,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE approved_units > 0)
        / NULLIF(COUNT(*),0), 1
    )                                                               AS pct_approved_filled
FROM batch_output_targets;

-- Muestra de datos backfilleados
SELECT
    bot."productId",
    p.name                      AS product_name,
    bot."plannedUnits"          AS planned,
    bot.actual_units            AS actual,
    bot.approved_units          AS approved,
    bot.defective_units         AS defective,
    CASE WHEN bot."plannedUnits" > 0
         THEN ROUND(100.0 * bot.approved_units / bot."plannedUnits", 1)
         ELSE NULL
    END                         AS yield_pct
FROM batch_output_targets bot
JOIN products p ON p.id = bot."productId"
WHERE bot.actual_units > 0 OR bot.approved_units > 0
ORDER BY bot."createdAt" DESC
LIMIT 15;
