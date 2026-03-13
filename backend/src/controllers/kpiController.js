const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * GET /api/production-kpis
 * Query params: days (default 30), operatorId (optional)
 *
 * Returns:
 *  - timeKpis: avg/min/max duration per process type
 *  - operatorKpis: per-operator summary (speed + quality)
 *  - qualityKpis: defective summary from EMPAQUE notes
 */
const getProductionKpis = async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const operatorId = req.query.operatorId || null;

        const since = new Date();
        since.setDate(since.getDate() - days);

        // ── Base WHERE clause (raw) ───────────────────────────────────────────
        // We use $queryRaw for duration calculations
        const operatorFilter = operatorId ? `AND n."executed_by" = '${operatorId}'` : '';

        // ── 1. TIME KPIs per process type ─────────────────────────────────────
        const timeRows = await prisma.$queryRawUnsafe(`
            SELECT
                pt.name                                        AS process_type,
                pt.code                                        AS process_code,
                COUNT(n.id)::int                               AS total,
                ROUND(AVG(EXTRACT(EPOCH FROM (n."completed_at" - n."started_at"))/60)::numeric, 1) AS avg_min,
                ROUND(MIN(EXTRACT(EPOCH FROM (n."completed_at" - n."started_at"))/60)::numeric, 1) AS min_min,
                ROUND(MAX(EXTRACT(EPOCH FROM (n."completed_at" - n."started_at"))/60)::numeric, 1) AS max_min,
                ROUND(STDDEV(EXTRACT(EPOCH FROM (n."completed_at" - n."started_at"))/60)::numeric, 1) AS std_min
            FROM assembly_notes n
            JOIN process_types pt ON pt.id = n."process_type_id"
            WHERE n.status = 'COMPLETED'
              AND n."started_at" IS NOT NULL
              AND n."completed_at" IS NOT NULL
              AND n."started_at" >= $1
              ${operatorFilter}
            GROUP BY pt.id, pt.name, pt.code
            ORDER BY avg_min ASC
        `, since);

        // ── 2. OPERATOR KPIs ─────────────────────────────────────────────────
        const operatorRows = await prisma.$queryRawUnsafe(`
            SELECT
                u.id                                           AS operator_id,
                u.name                                         AS operator_name,
                COUNT(n.id)::int                               AS total_notes,
                ROUND(AVG(EXTRACT(EPOCH FROM (n."completed_at" - n."started_at"))/60)::numeric, 1) AS avg_duration_min,
                ROUND(MIN(EXTRACT(EPOCH FROM (n."completed_at" - n."started_at"))/60)::numeric, 1) AS min_duration_min,
                ROUND(MAX(EXTRACT(EPOCH FROM (n."completed_at" - n."started_at"))/60)::numeric, 1) AS max_duration_min,
                COUNT(CASE WHEN pt.code IN ('CONTEO','EMPAQUE','ENSAMBLE') THEN 1 END)::int         AS packaging_notes
            FROM assembly_notes n
            JOIN users u ON u.id = n."executed_by"
            LEFT JOIN process_types pt ON pt.id = n."process_type_id"
            WHERE n.status = 'COMPLETED'
              AND n."started_at" IS NOT NULL
              AND n."completed_at" IS NOT NULL
              AND n."started_at" >= $1
            GROUP BY u.id, u.name
            ORDER BY avg_duration_min ASC
        `, since);

        // ── 3. QUALITY KPIs from EMPAQUE processParameters ───────────────────
        const empaqueNotes = await prisma.assemblyNote.findMany({
            where: {
                status: 'COMPLETED',
                startedAt: { gte: since },
                processType: { code: 'EMPAQUE' },
            },
            select: {
                id: true,
                noteNumber: true,
                startedAt: true,
                completedAt: true,
                processParameters: true,
                actualQuantity: true,
                targetQuantity: true,
                executedBy: { select: { id: true, name: true } },
                productionBatch: { select: { batchNumber: true } }
            }
        });

        const qualityData = empaqueNotes.map(n => {
            const params = n.processParameters || {};
            const defective = parseFloat(params.empaque?.defective_qty || params.defective_count || params.defectiveCount || 0);
            const total = parseFloat(n.actualQuantity || n.targetQuantity || 1);
            const defectivePct = total > 0 ? parseFloat(((defective / total) * 100).toFixed(2)) : 0;
            const durationMin = n.startedAt && n.completedAt
                ? parseFloat(((n.completedAt - n.startedAt) / 60000).toFixed(1)) : null;
            return {
                noteNumber: n.noteNumber,
                batchNumber: n.productionBatch?.batchNumber,
                operatorName: n.executedBy?.name || 'N/A',
                operatorId: n.executedBy?.id,
                defectiveCount: defective,
                totalUnits: total,
                defectivePct,
                durationMin,
                date: n.startedAt
            };
        });

        const avgDefectivePct = qualityData.length > 0
            ? parseFloat((qualityData.reduce((s, d) => s + d.defectivePct, 0) / qualityData.length).toFixed(2))
            : 0;

        // ── 4. QUALITY per operator (from EMPAQUE) ────────────────────────────
        const qualityByOperator = {};
        for (const d of qualityData) {
            if (!d.operatorId) continue;
            if (!qualityByOperator[d.operatorId]) {
                qualityByOperator[d.operatorId] = { name: d.operatorName, pcts: [] };
            }
            qualityByOperator[d.operatorId].pcts.push(d.defectivePct);
        }
        const operatorQuality = Object.entries(qualityByOperator).map(([id, v]) => ({
            operatorId: id,
            operatorName: v.name,
            avgDefectivePct: parseFloat((v.pcts.reduce((s, x) => s + x, 0) / v.pcts.length).toFixed(2))
        }));

        // ── 5. Combined operator ranking (speed + quality) ────────────────────
        const combined = operatorRows.map(op => {
            const q = operatorQuality.find(o => o.operatorId === op.operator_id);
            const defectivePct = q?.avgDefectivePct ?? null;
            // speed score: lower duration = better (normalize to 0-100 relative to peers)
            // quality score: lower defective% = better
            return {
                operatorId: op.operator_id,
                operatorName: op.operator_name,
                totalNotes: op.total_notes,
                avgDurationMin: op.avg_duration_min,
                minDurationMin: op.min_duration_min,
                maxDurationMin: op.max_duration_min,
                packagingNotes: op.packaging_notes,
                avgDefectivePct: defectivePct
            };
        });

        // Normalize scores for ranking
        const durations = combined.map(o => o.avgDurationMin).filter(Boolean);
        const maxDur = Math.max(...durations) || 1;
        const minDur = Math.min(...durations) || 1;
        const defPcts = combined.map(o => o.avgDefectivePct).filter(v => v !== null);
        const maxDef = Math.max(...defPcts) || 1;

        const ranked = combined.map(op => {
            const speedScore = op.avgDurationMin != null && maxDur !== minDur
                ? Math.round(100 - ((op.avgDurationMin - minDur) / (maxDur - minDur)) * 100)
                : op.avgDurationMin != null ? 100 : null;
            const qualityScore = op.avgDefectivePct != null
                ? Math.round(100 - (op.avgDefectivePct / Math.max(maxDef, 1)) * 100)
                : null;
            const overallScore = (speedScore != null && qualityScore != null)
                ? Math.round(speedScore * 0.4 + qualityScore * 0.6)
                : speedScore ?? qualityScore ?? null;
            return { ...op, speedScore, qualityScore, overallScore };
        }).sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));

        // ── 6. Summary stats ──────────────────────────────────────────────────
        const allCompletedNotes = await prisma.assemblyNote.count({
            where: { status: 'COMPLETED', startedAt: { gte: since } }
        });

        const globalAvgRow = await prisma.$queryRawUnsafe(`
            SELECT ROUND(AVG(EXTRACT(EPOCH FROM (n."completed_at" - n."started_at"))/60)::numeric, 1) AS global_avg_min
            FROM assembly_notes n
            WHERE n.status = 'COMPLETED'
              AND n."started_at" IS NOT NULL
              AND n."completed_at" IS NOT NULL
              AND n."started_at" >= $1
        `, since);

        res.json({
            meta: { days, since, generatedAt: new Date() },
            summary: {
                totalCompleted: allCompletedNotes,
                globalAvgMin: globalAvgRow[0]?.global_avg_min ?? null,
                avgDefectivePct,
                empaqueNotes: qualityData.length,
            },
            timeKpis: timeRows,
            operatorKpis: ranked,
            qualityKpis: {
                detail: qualityData.sort((a, b) => b.defectivePct - a.defectivePct),
                byOperator: operatorQuality.sort((a, b) => a.avgDefectivePct - b.avgDefectivePct),
            }
        });

    } catch (err) {
        console.error('[KPI] Error:', err);
        res.status(500).json({ error: 'Error generando KPIs de producción', detail: err.message });
    }
};

/**
 * GET /api/production-kpis/operators
 * Returns list of operators who have executed at least one note, for filter dropdown.
 */
const getOperators = async (req, res) => {
    try {
        const operators = await prisma.assemblyNote.findMany({
            where: { executedById: { not: null } },
            select: { executedBy: { select: { id: true, name: true } } },
            distinct: ['executedById']
        });
        res.json(operators.map(n => n.executedBy).filter(Boolean));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = { getProductionKpis, getOperators };
