const { Pool } = require('pg');

const FORENSIC_DB = 'gestionpbi_forensic_rebuild_20260416';

const DATASETS = {
    completed_notes: {
        table: 'forensic_completed_notes',
        label: 'Notas completadas',
        kind: 'raw',
    },
    produced_lots: {
        table: 'forensic_unique_produced_lots',
        label: 'Lotes producidos',
        kind: 'raw',
    },
    lot_consumptions: {
        table: 'forensic_lot_consumptions',
        label: 'Consumos con lote',
        kind: 'raw',
    },
    stock_only_consumptions: {
        table: 'forensic_stock_only_consumptions',
        label: 'Consumos solo stock',
        kind: 'raw',
    },
    finished_product_lots: {
        table: 'forensic_finished_product_lots',
        label: 'Producto terminado',
        kind: 'raw',
    },
    rpa_material_lots: {
        table: 'forensic_rpa_material_lots',
        label: 'Lotes RPA materia prima',
        kind: 'raw',
    },
    empaque_outputs: {
        table: 'forensic_empaque_outputs',
        label: 'Salidas de empaque',
        kind: 'raw',
    },
    batch_reuse: {
        table: 'forensic_batch_reuse',
        label: 'Reuso de batches',
        kind: 'raw',
    },
    upload_files: {
        table: 'forensic_upload_files',
        label: 'Archivos recuperados',
        kind: 'files',
    },
};

let pool;

const getForensicConnectionString = () => {
    if (process.env.FORENSIC_DATABASE_URL) return process.env.FORENSIC_DATABASE_URL;
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL no configurado');
    }

    const url = new URL(process.env.DATABASE_URL.replace(/^"|"$/g, ''));
    url.pathname = `/${FORENSIC_DB}`;
    return url.toString();
};

const getPool = () => {
    if (!pool) {
        pool = new Pool({
            connectionString: getForensicConnectionString(),
            max: 3,
            idleTimeoutMillis: 10000,
        });
    }
    return pool;
};

const parseLimit = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 50;
    return Math.min(parsed, 200);
};

const parsePage = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const buildRawWhere = ({ search, dateFrom, dateTo }) => {
    const clauses = [];
    const values = [];

    if (search) {
        values.push(`%${search}%`);
        clauses.push(`raw::text ILIKE $${values.length}`);
    }
    if (dateFrom) {
        values.push(dateFrom);
        clauses.push(`COALESCE(raw->>'localDay', left(raw->>'ts', 10)) >= $${values.length}`);
    }
    if (dateTo) {
        values.push(dateTo);
        clauses.push(`COALESCE(raw->>'localDay', left(raw->>'ts', 10)) <= $${values.length}`);
    }

    return {
        values,
        whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    };
};

const buildFileWhere = ({ search, dateFrom, dateTo }) => {
    const clauses = [];
    const values = [];

    if (search) {
        values.push(`%${search}%`);
        clauses.push(`path ILIKE $${values.length}`);
    }
    if (dateFrom) {
        values.push(dateFrom);
        clauses.push(`mtime::date >= $${values.length}::date`);
    }
    if (dateTo) {
        values.push(dateTo);
        clauses.push(`mtime::date <= $${values.length}::date`);
    }

    return {
        values,
        whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    };
};

const rawSelect = (table) => `
    SELECT
        id,
        raw,
        raw->>'ts' AS ts,
        COALESCE(raw->>'localDay', left(raw->>'ts', 10)) AS local_day,
        raw->>'source' AS source,
        raw->>'noteId' AS note_id,
        COALESCE(raw->>'processType', raw#>>'{rpa,processType}') AS process_type,
        raw->>'stageName' AS stage_name,
        COALESCE(raw->>'productName', raw#>>'{rpa,productName}') AS product_name,
        raw->>'productId' AS product_id,
        raw->>'lotNumber' AS lot_number,
        COALESCE(raw->>'quantity', raw->>'actualQuantity', raw->>'quantityUsed', raw->>'ensambleQty') AS quantity,
        raw->>'remaining' AS remaining,
        raw->>'evidence' AS evidence,
        jsonb_array_length(COALESCE(raw->'consumptions', '[]'::jsonb)) AS consumption_count,
        jsonb_array_length(COALESCE(raw->'stockOnlyConsumptions', '[]'::jsonb)) AS stock_only_count
    FROM ${table}
`;

const normalizeRawRow = (row) => ({
    id: Number(row.id),
    ts: row.ts,
    localDay: row.local_day,
    source: row.source,
    noteId: row.note_id,
    processType: row.process_type,
    stageName: row.stage_name,
    productName: row.product_name,
    productId: row.product_id,
    lotNumber: row.lot_number,
    quantity: row.quantity != null ? Number(row.quantity) : null,
    remaining: row.remaining != null ? Number(row.remaining) : null,
    evidence: row.evidence,
    consumptionCount: Number(row.consumption_count || 0),
    stockOnlyCount: Number(row.stock_only_count || 0),
    raw: row.raw,
});

const normalizeFileRow = (row) => ({
    id: Number(row.id),
    ts: row.mtime,
    localDay: row.mtime ? String(row.mtime).slice(0, 10) : null,
    path: row.path,
    fileName: row.path ? row.path.split('/').pop() : null,
    sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : null,
    raw: {
        path: row.path,
        sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : null,
        mtime: row.mtime,
    },
});

const getSummary = async (req, res) => {
    try {
        const db = getPool();
        const countsSql = Object.entries(DATASETS)
            .map(([key, dataset]) => `SELECT '${key}' AS key, count(*)::int AS count FROM ${dataset.table}`)
            .join(' UNION ALL ');

        const [countsResult, completedByDay, producedByProduct, latestNotes, latestLots, latestFiles] = await Promise.all([
            db.query(countsSql),
            db.query(`
                SELECT COALESCE(raw->>'localDay', left(raw->>'ts', 10)) AS day, count(*)::int AS count
                FROM forensic_completed_notes
                GROUP BY 1
                ORDER BY day DESC NULLS LAST
                LIMIT 14
            `),
            db.query(`
                SELECT raw->>'productName' AS product_name, count(*)::int AS lots, COALESCE(sum(NULLIF(raw->>'quantity', '')::numeric), 0)::float AS quantity
                FROM forensic_unique_produced_lots
                GROUP BY 1
                ORDER BY lots DESC, product_name ASC NULLS LAST
                LIMIT 12
            `),
            db.query(`${rawSelect('forensic_completed_notes')} ORDER BY raw->>'ts' DESC NULLS LAST, id DESC LIMIT 8`),
            db.query(`${rawSelect('forensic_unique_produced_lots')} ORDER BY raw->>'ts' DESC NULLS LAST, id DESC LIMIT 8`),
            db.query(`
                SELECT id, mtime, path, size_bytes
                FROM forensic_upload_files
                ORDER BY mtime DESC NULLS LAST, id DESC
                LIMIT 8
            `),
        ]);

        const counts = {};
        for (const row of countsResult.rows) {
            counts[row.key] = Number(row.count || 0);
        }

        res.json({
            success: true,
            database: FORENSIC_DB,
            datasets: Object.entries(DATASETS).map(([key, dataset]) => ({
                key,
                label: dataset.label,
                count: counts[key] || 0,
            })),
            counts,
            completedByDay: completedByDay.rows.map((row) => ({
                day: row.day,
                count: Number(row.count || 0),
            })),
            producedByProduct: producedByProduct.rows.map((row) => ({
                productName: row.product_name || 'Sin producto',
                lots: Number(row.lots || 0),
                quantity: Number(row.quantity || 0),
            })),
            latest: {
                completedNotes: latestNotes.rows.map(normalizeRawRow),
                producedLots: latestLots.rows.map(normalizeRawRow),
                uploadFiles: latestFiles.rows.map(normalizeFileRow),
            },
        });
    } catch (error) {
        console.error('[forensicRecovery] summary error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const listRecords = async (req, res) => {
    try {
        const datasetKey = req.query.dataset || 'completed_notes';
        const dataset = DATASETS[datasetKey];
        if (!dataset) {
            return res.status(400).json({ success: false, error: 'Dataset forense invalido' });
        }

        const page = parsePage(req.query.page);
        const limit = parseLimit(req.query.limit);
        const offset = (page - 1) * limit;
        const search = String(req.query.search || '').trim();
        const dateFrom = String(req.query.dateFrom || '').trim();
        const dateTo = String(req.query.dateTo || '').trim();

        const db = getPool();
        const where = dataset.kind === 'files'
            ? buildFileWhere({ search, dateFrom, dateTo })
            : buildRawWhere({ search, dateFrom, dateTo });

        const countResult = await db.query(
            `SELECT count(*)::int AS total FROM ${dataset.table} ${where.whereSql}`,
            where.values
        );

        const pagingValues = [...where.values, limit, offset];
        const rowsResult = dataset.kind === 'files'
            ? await db.query(`
                SELECT id, mtime, path, size_bytes
                FROM ${dataset.table}
                ${where.whereSql}
                ORDER BY mtime DESC NULLS LAST, id DESC
                LIMIT $${where.values.length + 1}
                OFFSET $${where.values.length + 2}
            `, pagingValues)
            : await db.query(`
                ${rawSelect(dataset.table)}
                ${where.whereSql}
                ORDER BY raw->>'ts' DESC NULLS LAST, id DESC
                LIMIT $${where.values.length + 1}
                OFFSET $${where.values.length + 2}
            `, pagingValues);

        const total = Number(countResult.rows[0]?.total || 0);
        res.json({
            success: true,
            dataset: {
                key: datasetKey,
                label: dataset.label,
                count: total,
            },
            rows: dataset.kind === 'files'
                ? rowsResult.rows.map(normalizeFileRow)
                : rowsResult.rows.map(normalizeRawRow),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        });
    } catch (error) {
        console.error('[forensicRecovery] records error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    getSummary,
    listRecords,
};
