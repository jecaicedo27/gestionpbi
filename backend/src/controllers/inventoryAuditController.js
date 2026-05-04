const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const siigoService = require('../services/siigoService');

async function fetchAllSiigoProducts() {
    let all = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
        const { results, pagination } = await siigoService.getProducts(page, 100);
        all = all.concat(results);
        hasMore = page < pagination.total_pages;
        page++;
    }
    return all;
}

exports.runAudit = async (req, res) => {
    try {
        const siigoProducts = await fetchAllSiigoProducts();
        const siigoById = {};
        const siigoByCode = {};
        for (const sp of siigoProducts) {
            const entry = {
                code: sp.code,
                name: sp.name,
                siigoQty: sp.available_quantity || 0,
                warehouses: sp.warehouses || [],
            };
            siigoById[sp.id] = entry;
            siigoByCode[sp.code] = entry;
        }

        const dbProducts = await prisma.product.findMany({
            where: { active: true },
            select: { id: true, sku: true, name: true, type: true, currentStock: true, siigoId: true }
        });

        // --- Raw materials: sum MaterialLot.currentQuantity by product ---
        const materialLots = await prisma.materialLot.groupBy({
            by: ['productId'],
            where: { status: 'AVAILABLE', currentQuantity: { gt: 0 } },
            _sum: { currentQuantity: true }
        });
        const materialByProduct = {};
        for (const ml of materialLots) {
            if (ml.productId) materialByProduct[ml.productId] = ml._sum.currentQuantity || 0;
        }

        // --- Finished products: sum FinishedLotStock.currentQuantity by product ---
        const finishedLots = await prisma.finishedLotStock.groupBy({
            by: ['productId'],
            where: { status: 'AVAILABLE', currentQuantity: { gt: 0 } },
            _sum: { currentQuantity: true }
        });
        const finishedByProduct = {};
        for (const fl of finishedLots) {
            finishedByProduct[fl.productId] = fl._sum.currentQuantity || 0;
        }

        // --- Recent RPA issues (last 7 days) ---
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const rpaIssues = await prisma.rpaExecution.findMany({
            where: {
                startedAt: { gte: sevenDaysAgo },
                OR: [
                    { status: 'FAILED' },
                    { status: 'ERROR' },
                ]
            },
            select: { id: true, productName: true, quantity: true, status: true, errorMessage: true, startedAt: true, assemblyNoteId: true },
            orderBy: { startedAt: 'desc' }
        });

        // --- Detect duplicate RPAs (same assemblyNoteId, multiple SUCCESS) ---
        const rpaSuccessful = await prisma.rpaExecution.groupBy({
            by: ['assemblyNoteId'],
            where: { status: 'SUCCESS', startedAt: { gte: sevenDaysAgo }, assemblyNoteId: { not: null } },
            _count: { id: true }
        });
        const duplicateRpas = rpaSuccessful.filter(r => r._count.id > 1);

        let duplicateRpaDetails = [];
        if (duplicateRpas.length > 0) {
            duplicateRpaDetails = await prisma.rpaExecution.findMany({
                where: {
                    assemblyNoteId: { in: duplicateRpas.map(d => d.assemblyNoteId) },
                    status: 'SUCCESS'
                },
                select: { id: true, productName: true, quantity: true, assemblyNoteId: true, startedAt: true, siigoNoteCode: true },
                orderBy: { startedAt: 'desc' }
            });
        }

        // --- Unreversed consumptions (app deleted batch but Siigo wasn't reversed) ---
        // Check assemblyNotes referenced in lotConsumptions that no longer exist
        const orphanConsumptions = await prisma.$queryRaw`
            SELECT lc.id, lc."quantityUsed", lc."usedAt", ml."siigoProductName", ml."lotNumber"
            FROM lot_consumptions lc
            JOIN material_lots ml ON ml.id = lc."materialLotId"
            LEFT JOIN assembly_notes an ON an.id = lc.assembly_note_id
            WHERE an.id IS NULL
            AND lc."usedAt" > ${sevenDaysAgo}
            LIMIT 20
        `;

        // --- Build comparison report ---
        const discrepancies = [];
        for (const dbProd of dbProducts) {
            const siigo = (dbProd.siigoId && siigoById[dbProd.siigoId]) || siigoByCode[dbProd.sku];
            if (!siigo) continue;

            const isMaterial = dbProd.type === 'MATERIA_PRIMA' || dbProd.type === 'BASE_CITRICA';
            const appLotStock = isMaterial
                ? (materialByProduct[dbProd.id] || 0)
                : (finishedByProduct[dbProd.id] || 0);

            const siigoQty = siigo.siigoQty;
            const lastSyncStock = dbProd.currentStock;

            const diffSiigoVsApp = siigoQty - appLotStock;
            const diffSiigoVsSync = siigoQty - lastSyncStock;

            if (Math.abs(diffSiigoVsApp) > 0.5 || Math.abs(diffSiigoVsSync) > 0.5) {
                discrepancies.push({
                    sku: dbProd.sku,
                    name: dbProd.name,
                    type: dbProd.type,
                    siigoQty: Math.round(siigoQty * 100) / 100,
                    appLotStock,
                    lastSyncStock,
                    diffSiigoVsLots: Math.round(diffSiigoVsApp * 100) / 100,
                    diffSiigoVsSync: Math.round(diffSiigoVsSync * 100) / 100,
                });
            }
        }

        discrepancies.sort((a, b) => Math.abs(b.diffSiigoVsLots) - Math.abs(a.diffSiigoVsLots));

        res.json({
            timestamp: new Date().toISOString(),
            summary: {
                totalProductsChecked: dbProducts.length,
                totalSiigoProducts: siigoProducts.length,
                discrepancies: discrepancies.length,
                rpaFailures: rpaIssues.length,
                duplicateRpas: duplicateRpas.length,
                orphanConsumptions: orphanConsumptions.length,
            },
            discrepancies: discrepancies.slice(0, 50),
            rpaFailures: rpaIssues.slice(0, 20),
            duplicateRpas: duplicateRpaDetails,
            orphanConsumptions,
        });
    } catch (error) {
        console.error('Inventory audit error:', error);
        res.status(500).json({ error: error.message });
    }
};
