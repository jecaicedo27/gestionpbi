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
        const line = req.query.line || 'all';

        const since = new Date();
        since.setDate(since.getDate() - days);

        // ── Base WHERE clause (raw) ───────────────────────────────────────────
        // We use $queryRaw for duration calculations
        const operatorFilter = operatorId ? `AND n."executed_by" = '${operatorId}'` : '';
        
        let lineJoin = '';
        let lineWhere = '';
        if (line === 'geniality') {
            lineJoin = 'LEFT JOIN assembly_templates at ON at.id = n."template_id"';
            lineWhere = `AND (at.template_name ILIKE '%GENIALITY%' OR at.template_name ILIKE '%SIROPE%' OR at.template_name ILIKE '%ESCARCHAD%' OR at.template_name ILIKE '%SABORIZACION%' OR at.template_code LIKE 'GTPL%')`;
        } else if (line === 'liquipops') {
            lineJoin = 'LEFT JOIN assembly_templates at ON at.id = n."template_id"';
            lineWhere = `AND (n."template_id" IS NULL OR at.template_name ILIKE '%LIQUIPOPS%' OR at.template_name ILIKE '%PREMEZCLA%' OR at.template_name ILIKE '%PROTECCION%' OR at.template_name ILIKE '%COMPUESTO%' OR at.template_name ILIKE '%BASE%')`;
        }

        // Prisma filters
        const genialityPrismaFilter = {
            OR: [
                { templateName: { contains: 'GENIALITY', mode: 'insensitive' } },
                { templateName: { contains: 'SIROPE', mode: 'insensitive' } },
                { templateName: { contains: 'ESCARCHAD', mode: 'insensitive' } },
                { templateName: { contains: 'SABORIZACION', mode: 'insensitive' } },
                { templateCode: { startsWith: 'GTPL' } }
            ]
        };
        const liquipopsPrismaFilter = {
            OR: [
                { templateId: null },
                { template: {
                    OR: [
                        { templateName: { contains: 'LIQUIPOPS', mode: 'insensitive' } },
                        { templateName: { contains: 'BASE', mode: 'insensitive' } },
                        { templateName: { contains: 'COMPUESTO', mode: 'insensitive' } },
                        { templateName: { contains: 'PROTECCION', mode: 'insensitive' } },
                        { templateName: { contains: 'PREMEZCLA', mode: 'insensitive' } }
                    ]
                }}
            ]
        };

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
            ${lineJoin}
            WHERE n.status = 'COMPLETED'
              AND n."started_at" IS NOT NULL
              AND n."completed_at" IS NOT NULL
              AND n."started_at" >= $1
              ${operatorFilter}
              ${lineWhere}
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
            ${lineJoin}
            WHERE n.status = 'COMPLETED'
              AND n."started_at" IS NOT NULL
              AND n."completed_at" IS NOT NULL
              AND n."started_at" >= $1
              ${lineWhere}
            GROUP BY u.id, u.name
            ORDER BY avg_duration_min ASC
        `, since);

        // ── 3. QUALITY KPIs from EMPAQUE processParameters ───────────────────
        const empaqueWhere = {
            status: 'COMPLETED',
            startedAt: { gte: since },
            processType: { code: 'EMPAQUE' },
        };
        if (line === 'geniality') empaqueWhere.template = genialityPrismaFilter;
        if (line === 'liquipops') Object.assign(empaqueWhere, liquipopsPrismaFilter);

        const empaqueNotes = await prisma.assemblyNote.findMany({
            where: empaqueWhere,
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
        const allNotesWhere = { status: 'COMPLETED', startedAt: { gte: since } };
        if (line === 'geniality') allNotesWhere.template = genialityPrismaFilter;
        if (line === 'liquipops') Object.assign(allNotesWhere, liquipopsPrismaFilter);

        const allCompletedNotes = await prisma.assemblyNote.count({
            where: allNotesWhere
        });

        const globalAvgRow = await prisma.$queryRawUnsafe(`
            SELECT ROUND(AVG(EXTRACT(EPOCH FROM (n."completed_at" - n."started_at"))/60)::numeric, 1) AS global_avg_min
            FROM assembly_notes n
            ${lineJoin}
            WHERE n.status = 'COMPLETED'
              AND n."started_at" IS NOT NULL
              AND n."completed_at" IS NOT NULL
              AND n."started_at" >= $1
              ${lineWhere}
        `, since);

        // ── 7. FILLING KPI — Geniality batches in period ─────────────────────
        const SAB_PER_UNIT = { '1000': 1350, '360': 500 };
        const genEmpaqueNotes = await prisma.assemblyNote.findMany({
            where: {
                status: 'COMPLETED',
                startedAt: { gte: since },
                processType: { code: 'EMPAQUE' },
                template: genialityPrismaFilter
            },
            select: {
                id: true, stageName: true, targetQuantity: true, processParameters: true,
                productionBatch: { select: { id: true, batchNumber: true } },
                product: { select: { name: true, price: true } }
            }
        });

        // Group by batch
        const batchMap = {};
        for (const n of genEmpaqueNotes) {
            const bn = n.productionBatch?.batchNumber;
            if (!bn) continue;
            if (!batchMap[bn]) batchMap[bn] = { batchId: n.productionBatch.id, batchNumber: bn, noteIds: [], expectedG: 0, units: 0, plannedUnits: 0, actualUnits: 0, breakdown: {}, defective: 0, defectiveBreakdown: [], lostMoney: 0 };
            
            const sizeMatch = n.product?.name?.match(/(\d+)\s*(ml|g|G|ML|GR|gr)/i) || n.stageName?.match(/(\d+)/);
            const sizeStr = sizeMatch ? sizeMatch[1] : (n.stageName?.includes('1000') ? '1000' : '360');
            const size = sizeStr.includes('1000') ? '1000' : sizeStr.includes('360') ? '360' : '1000';
            
            const gpv = SAB_PER_UNIT[size] || 1350;
            const units = n.targetQuantity || 0;
            
            const params = typeof n.processParameters === 'string' ? JSON.parse(n.processParameters) : (n.processParameters || {});
            const def = parseInt((params.empaque && params.empaque.defective_qty) || params.defectuoso || 0);

            let reasonText = 'S/N';
            const reasonsArr = (params.empaque && Array.isArray(params.empaque.defect_reasons)) ? params.empaque.defect_reasons : [];
            if (reasonsArr.length > 0) {
                const groupedReasons = {};
                reasonsArr.forEach(r => {
                    const causeStr = r.cause || r.reason || r.type || 'Otra';
                    groupedReasons[causeStr] = (groupedReasons[causeStr] || 0) + (r.qty || 1);
                });
                reasonText = Object.entries(groupedReasons).map(([cause, q]) => `${q}x ${cause.replace(/_/g, ' ')}`).join(', ');
            }

            const unitPrice = n.product?.price || (size === '1000' ? 26650 : 14650);
            const AVG_DISCOUNT = 0.35; // 35% descuento distribuidor 
            const effectivePrice = unitPrice * (1 - AVG_DISCOUNT);
            
            let lostCOP = 0;
            if (def > 0) {
                lostCOP = def * effectivePrice;
                batchMap[bn].defectiveBreakdown.push({
                    size: size + ' ml',
                    qty: def,
                    reasonText: reasonText,
                    lostMoney: lostCOP
                });
            }

            const fTarget = n.targetQuantity || 0;
            const fActual = n.actualQuantity || 0;
            
            batchMap[bn].expectedG += fTarget * gpv;
            batchMap[bn].actualUnits += fActual;
            batchMap[bn].plannedUnits += fTarget;
            
            if (!batchMap[bn].breakdown[size + ' ml']) {
                batchMap[bn].breakdown[size + ' ml'] = { planned: 0, actual: 0 };
            }
            batchMap[bn].breakdown[size + ' ml'].planned += fTarget;
            batchMap[bn].breakdown[size + ' ml'].actual += fActual;

            batchMap[bn].defective += def;
            batchMap[bn].lostMoney += lostCOP;
            batchMap[bn].noteIds.push(n.id);
        }

        const fillingRows = [];
        const batchNumbers = Object.keys(batchMap);
        
        // Determinar unidades Reales y Planeadas a partir de la fase de CONTEO
        const conteoNotes = await prisma.assemblyNote.findMany({
            where: { processType: { code: 'CONTEO' }, status: 'COMPLETED', productionBatch: { batchNumber: { in: batchNumbers } } },
            select: { processParameters: true, productionBatch: { select: { batchNumber: true } } }
        });
        
        for (const cn of conteoNotes) {
            const bn = cn.productionBatch?.batchNumber;
            if (!batchMap[bn]) continue;
            const params = typeof cn.processParameters === 'string' ? JSON.parse(cn.processParameters) : (cn.processParameters || {});
            
            if (params.conteo && typeof params.conteo === 'object') {
                batchMap[bn].hasConteo = true;
                batchMap[bn].plannedUnits = 0;
                batchMap[bn].actualUnits = 0;
                batchMap[bn].expectedG = 0;
                batchMap[bn].breakdown = {};
                
                for (const [prodName, data] of Object.entries(params.conteo)) {
                    const sizeMatch = prodName.match(/(\d+)\s*(ml|g|G|ML|GR|gr)/i);
                    const size = sizeMatch ? sizeMatch[1] : (prodName.includes('1000') ? '1000' : '360');
                    const sizeLabel = size + ' ml';
                    
                    const p = parseInt(data.planned || 0);
                    const a = parseInt(data.actual || 0);
                    const gpv = SAB_PER_UNIT[size] || 1350;
                    
                    batchMap[bn].plannedUnits += p;
                    batchMap[bn].actualUnits += a;
                    // Proyectamos el consumo esperado de Sirope en base a las UNIDADES REALES empacadas
                    batchMap[bn].expectedG += a * gpv;
                    
                    batchMap[bn].breakdown[sizeLabel] = { planned: p, actual: a };
                }
            }
        }
        
        // Determinar cantidad de sirope preparada en ENSAMBLE (ESPERADO/PRODUCIDAS)
        const ensambleNotes = await prisma.assemblyNote.findMany({
            where: { processType: { code: { in: ['ENSAMBLE', 'PRE-ENSAMBLE'] } }, status: 'COMPLETED', productionBatch: { batchNumber: { in: batchNumbers } } },
            select: { actualQuantity: true, targetQuantity: true, productionBatch: { select: { batchNumber: true } }, product: { select: { formulas: { select: { baseQuantity: true } } } } }
        });
        const ensMap = {};
        ensambleNotes.forEach(n => {
            const bn = n.productionBatch?.batchNumber;
            const fBase = n.product?.formulas?.[0]?.baseQuantity || 0;
            let value = n.actualQuantity || n.targetQuantity || 0;
            
            // Limit to max 10,000 kg (10,000,000 g) to prevent extreme arbitrary inputs, and take the highest value instead of summing naive steps.
            if (value > 10000000) value = 10000000;
            if (!ensMap[bn] || value > ensMap[bn]) {
                ensMap[bn] = value;
            }
        });

        for (const [bn, b] of Object.entries(batchMap)) {
            if (b.expectedG === 0) continue;
            
            const lcs = await prisma.lotConsumption.findMany({
                where: { assemblyNoteId: { in: b.noteIds } },
                include: { materialLot: { select: { siigoProductName: true, initialQuantity: true } } }
            });

            const liquidLcs = lcs.filter(lc => {
                const name = lc.materialLot?.siigoProductName?.toUpperCase() || '';
                return name.includes('SABORIZACION') || name.includes('SIROPE') || name.includes('ESCARCHAD');
            });

            // ESPERADO: Cantidad de sirope preparada (del ENSAMBLE o consumos parciales)
            let productionG = ensMap[bn] || (liquidLcs.length > 0 ? liquidLcs[0].materialLot.initialQuantity : 0);
            
            // Si por alguna razón sigue en 0, no mostrar merma irreal
            if (productionG === 0) productionG = b.expectedG;

            let mermaG = 0;
            let mermaPct = 0;
            let mermaLostMoney = 0;
            let excessMermaG = 0;

            if (productionG > 0) {
                // Merma = Lo que preparamos (tanque) - Lo que empacamos en tarros (b.expectedG que es UDS * formula)
                mermaG = productionG - b.expectedG;
                mermaPct = parseFloat(((mermaG / productionG) * 100).toFixed(1));
                
                const mermaTargetPct = 5;
                const tolerableMermaG = (productionG * mermaTargetPct) / 100;
                excessMermaG = Math.max(0, mermaG - tolerableMermaG);

                const GRAMS_PER_1000 = 1350; 
                const PRICE_1000 = 26650;
                const AVG_DISCOUNT = 0.35;
                const effectivePrice1000 = PRICE_1000 * (1 - AVG_DISCOUNT);
                
                const equivalentJarsLost = excessMermaG / GRAMS_PER_1000;
                mermaLostMoney = mermaG > tolerableMermaG ? (equivalentJarsLost * effectivePrice1000) : 0;
            }

            const defectivePct = b.defective > 0 ? parseFloat(((b.defective / (b.actualUnits + b.defective)) * 100).toFixed(1)) : 0;

            fillingRows.push({
                batchNumber: bn,
                plannedUnits: b.plannedUnits,
                actualUnits: b.hasConteo ? b.actualUnits : "Sin Reporte",
                breakdown: b.breakdown,
                defective: b.defective,
                defectivePct,
                defectiveBreakdown: b.defectiveBreakdown,
                lostMoney: b.lostMoney || 0,
                productionG: Math.round(productionG),
                actualConsumedG: 0,
                expectedG: Math.round(b.expectedG),
                mermaG: Math.round(mermaG),
                mermaPct,
                mermaLostMoney: Math.round(mermaLostMoney),
                excessMermaG: Math.round(excessMermaG),
                potentialExtra1000: Math.floor(Math.max(0, mermaG) / 1350),
                revenuePotential: Math.floor(Math.max(0, mermaG) / 1350) * 27000
            });
        }

        const totalMermaG = fillingRows.reduce((s, r) => s + r.mermaG, 0);
        const avgMermaPct = fillingRows.length > 0
            ? parseFloat((fillingRows.reduce((s, r) => s + r.mermaPct, 0) / fillingRows.length).toFixed(1)) : null;
        const totalPotentialRevenue = fillingRows.reduce((s, r) => s + r.revenuePotential, 0);

        // ── 8. FILLING KPI — Liquipops batches in period ─────────────────────
        const fillingLiqRows = [];
        let totalLiqMermaG = 0, avgLiqMermaPct = null;

        if (line === 'all' || line === 'liquipops') {
            const liqEmpaqueNotes = await prisma.assemblyNote.findMany({
                where: {
                    status: 'COMPLETED',
                    startedAt: { gte: since },
                    processType: { code: 'EMPAQUE' },
                    productionBatch: {
                        assemblyNotes: { some: { processType: { code: 'FORMACION' } } }
                    }
                },
                select: {
                    id: true, targetQuantity: true, actualQuantity: true, productId: true, processParameters: true,
                    productionBatch: { select: { id: true, batchNumber: true } },
                    product: { select: { name: true, price: true } }
                }
            });

            const productIds = [...new Set(liqEmpaqueNotes.map(n => n.productId).filter(Boolean))];
            const products = await prisma.product.findMany({
                where: { id: { in: productIds } },
                include: { formulas: { include: { items: { include: { ingredient: { select: { name: true } } } } } } }
            });
            const productGrams = {};
            for (const p of products) {
                const f = p.formulas[0];
                if (f) {
                    const spItem = f.items.find(i => i.ingredient.name.includes('ESFERAS') || i.ingredient.name.includes('COLA'));
                    productGrams[p.id] = spItem ? spItem.quantity : 0;
                } else { productGrams[p.id] = 0; }
            }

            const lbatchMap = {};
            for (const n of liqEmpaqueNotes) {
                const bn = n.productionBatch?.batchNumber;
                if (!bn) continue;
                if (!lbatchMap[bn]) lbatchMap[bn] = { batchId: n.productionBatch.id, batchNumber: bn, noteIds: [], expectedG: 0, plannedUnits: 0, actualUnits: 0, defective: 0, breakdown: {}, defectiveBreakdown: [] };
                const gpv = productGrams[n.productId] || 0;
                const pUnits = n.targetQuantity || 0;
                const aUnits = n.actualQuantity || 0;
                const params = typeof n.processParameters === 'string' ? JSON.parse(n.processParameters) : (n.processParameters || {});
                const def = parseInt((params.empaque && params.empaque.defective_qty) || params.defectuoso || 0);

                const sizeMatch = n.product?.name?.match(/(\d+)\s*(g|ml|G|ML|GR|gr|kg)/i);
                const sizeLabel = sizeMatch ? sizeMatch[0].toLowerCase() : 'uds';
                if (!lbatchMap[bn].breakdown[sizeLabel]) {
                    lbatchMap[bn].breakdown[sizeLabel] = { planned: 0, actual: 0 };
                }
                lbatchMap[bn].breakdown[sizeLabel].planned += pUnits;
                lbatchMap[bn].breakdown[sizeLabel].actual += aUnits;

                const reasonsArr = (params.empaque && Array.isArray(params.empaque.defect_reasons)) ? params.empaque.defect_reasons : [];
                let reasonText = 'S/N';
                if (reasonsArr.length > 0) {
                    const groupedReasons = {};
                    reasonsArr.forEach(r => {
                        const causeStr = r.cause || r.reason || r.type || 'Otra';
                        groupedReasons[causeStr] = (groupedReasons[causeStr] || 0) + (r.qty || 1);
                    });
                    reasonText = Object.entries(groupedReasons).map(([cause, q]) => `${q}x ${cause.replace(/_/g, ' ')}`).join(', ');
                }
                
                // Cálculo de dinero perdido
                const unitPrice = n.product?.price || 0;
                const AVG_DISCOUNT = 0.35; // 35% descuento promedio distribuidores
                const effectivePrice = unitPrice * (1 - AVG_DISCOUNT);
                let lostCOP = 0;

                if (def > 0) {
                    lostCOP = def * effectivePrice;
                    lbatchMap[bn].defectiveBreakdown.push({
                        size: sizeLabel,
                        qty: def,
                        reasonText: reasonText,
                        lostMoney: lostCOP
                    });
                }

                lbatchMap[bn].expectedG += aUnits * gpv; // Merma calculada en base a reales producidas
                lbatchMap[bn].plannedUnits += pUnits;
                lbatchMap[bn].actualUnits += aUnits;
                lbatchMap[bn].defective += def;
                lbatchMap[bn].lostMoney = (lbatchMap[bn].lostMoney || 0) + lostCOP;
                lbatchMap[bn].noteIds.push(n.id);
            }

            const batchNumbers = Object.keys(lbatchMap);
            if (batchNumbers.length > 0) {
                const formacionNotes = await prisma.assemblyNote.findMany({
                    where: { processType: { code: 'FORMACION' }, status: 'COMPLETED', productionBatch: { batchNumber: { in: batchNumbers } } },
                    select: { 
                        actualQuantity: true, 
                        productionBatch: { select: { batchNumber: true } },
                        product: { select: { formulas: { select: { baseQuantity: true } } } }
                    }
                });
                const formMap = {};
                formacionNotes.forEach(n => {
                    formMap[n.productionBatch.batchNumber] = n.product?.formulas?.[0]?.baseQuantity || n.actualQuantity || 150000;
                });

                for (const [bn, b] of Object.entries(lbatchMap)) {
                    const actualG = formMap[bn] || 150000;
                    const mermaG = actualG - b.expectedG;
                    const mermaPct = actualG > 0 ? parseFloat(((mermaG / actualG) * 100).toFixed(1)) : 0;
                    const defectivePct = b.defective > 0 ? parseFloat(((b.defective / (b.actualUnits + b.defective)) * 100).toFixed(1)) : 0;
                    
                    // Cálculo financiero de la Merma (Exceso sobre 5% de meta)
                    const mermaTargetPct = 5;
                    const tolerableMermaG = (actualG * mermaTargetPct) / 100;
                    const excessMermaG = Math.max(0, mermaG - tolerableMermaG);

                    const GRAMS_PER_1150 = 845;
                    const PRICE_1150 = 37500;
                    const AVG_DISCOUNT = 0.35;
                    const effectivePrice1150 = PRICE_1150 * (1 - AVG_DISCOUNT);
                    
                    const equivalentJarsLost = excessMermaG / GRAMS_PER_1150;
                    const mermaLostMoney = mermaG > tolerableMermaG ? (equivalentJarsLost * effectivePrice1150) : 0;

                    fillingLiqRows.push({
                        batchNumber: bn,
                        plannedUnits: b.plannedUnits,
                        actualUnits: b.actualUnits,
                        breakdown: b.breakdown,
                        defective: b.defective,
                        defectivePct: defectivePct,
                        defectiveBreakdown: b.defectiveBreakdown,
                        lostMoney: b.lostMoney || 0,
                        productionG: actualG,
                        expectedG: Math.round(b.expectedG),
                        mermaG: Math.round(mermaG),
                        mermaPct: mermaPct,
                        mermaLostMoney: Math.round(mermaLostMoney),
                        excessMermaG: Math.round(excessMermaG)
                    });
                }
            }

            totalLiqMermaG = fillingLiqRows.reduce((s, r) => s + r.mermaG, 0);
            avgLiqMermaPct = fillingLiqRows.length > 0
                ? parseFloat((fillingLiqRows.reduce((s, r) => s + r.mermaPct, 0) / fillingLiqRows.length).toFixed(1)) : null;
        }

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
            },
            fillingKpis: {
                batches: fillingRows.sort((a, b) => b.mermaPct - a.mermaPct),
                summary: {
                    batchCount: fillingRows.length,
                    totalMermaG,
                    avgMermaPct,
                    totalPotentialRevenue
                }
            },
            fillingLiquipops: {
                batches: fillingLiqRows.sort((a, b) => b.mermaPct - a.mermaPct),
                summary: {
                    batchCount: fillingLiqRows.length,
                    totalMermaG: totalLiqMermaG,
                    avgMermaPct: avgLiqMermaPct
                }
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
