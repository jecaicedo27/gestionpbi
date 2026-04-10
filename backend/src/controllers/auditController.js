const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getAuditReport = async (req, res) => {
    try {
        const take = parseInt(req.query.limit) || 50;

        const batches = await prisma.productionBatch.findMany({
            orderBy: { createdAt: 'desc' },
            take,
            include: {
                assemblyNotes: {
                    include: {
                        processType: true,
                        items: {
                            include: {
                                component: true
                            }
                        }
                    }
                }
            }
        });

        const report = [];

        for (const batch of batches) {
            const isLiquipops = batch.batchNumber.includes('LIQUIPOPS') || batch.batchNumber.includes('BICHE') || batch.batchNumber.includes('BLUEBERRY');
            const typeFlag = isLiquipops ? 'Liquipops' : 'Geniality/Sirope';
            
            for (const note of batch.assemblyNotes) {
                const processName = note.processType?.code || 'UNKNOWN';

                // Skip virtual Siigo assembly notes as they don't hold physical consumptions
                if (processName === 'ENSAMBLE' || processName === 'G_ENSAMBLE') {
                    continue;
                }

                // Fetch lot consumptions associated directly with this note
                const consumptions = await prisma.lotConsumption.findMany({
                    where: { assemblyNoteId: note.id },
                    include: { materialLot: { include: { product: true } } }
                });

                for (const item of note.items) {
                    if (!item.componentId && !item.materialLotId) continue;
                    
                    const compName = item.component?.name || item.materialLot?.product?.name || 'Unknown';
                    const isPackaging = !item.materialLotId && processName === 'EMPAQUE';
                    const compTypeOrig = item.component?.type === 'MATERIA_PRIMA' ? 'Materia Prima' : (item.component?.type || '');
                    const compType = isPackaging ? 'Empaque' : compTypeOrig;
                    
                    const planned = item.plannedQuantity || 0;
                    const direction = planned === 0 ? 'Salida' : 'Entrada';
                    let actual = item.actualQuantity !== null ? item.actualQuantity : (note.status === 'COMPLETED' ? planned : 0);
                    
                    let consumedQty = 0;
                    const itemCons = consumptions.filter(c => 
                        c.materialLot?.productId === item.componentId || c.materialLotId === item.materialLotId
                    );
                    consumedQty = itemCons.reduce((acc, c) => acc + c.quantityUsed, 0);

                    // Fallback: If no physical consumptions are explicitly linked to this note,
                    // but the item was flagged as consumed logically (legacy/RPA behavior),
                    // we assume the actual quantity was consumed.
                    if (isPackaging && consumedQty === 0 && item.consumed) {
                        consumedQty = actual;
                    }
                    
                    const diff = note.status === 'COMPLETED' ? consumedQty - actual : 0;
                    
                    report.push({
                        id: `${note.id}-${item.id}`,
                        batchNumber: batch.batchNumber,
                        type: typeFlag,
                        process: processName,
                        status: note.status,
                        component: compName,
                        componentType: compType,
                        direction: direction,
                        planned: planned,
                        actual: actual,
                        consumed: consumedQty,
                        diff: diff,
                        date: batch.createdAt
                    });
                }
            }
        }

        // Aggregate by Batch and Component to resolve cross-note consumptions (e.g., PESAJE vs COCCION)
        const aggregatedMap = new Map();
        for (const row of report) {
            const key = `${row.batchNumber}-${row.component}-${row.direction}`;
            if (!aggregatedMap.has(key)) {
                aggregatedMap.set(key, { ...row });
            } else {
                const existing = aggregatedMap.get(key);
                existing.planned += row.planned;
                existing.actual += row.actual;
                existing.consumed += row.consumed;
                
                if (row.status !== 'COMPLETED') {
                    existing.status = row.status;
                }
                
                existing.diff = existing.status === 'COMPLETED' ? existing.consumed - existing.actual : 0;
                
                if (existing.process !== row.process) {
                    existing.process = 'CONSOLIDADO';
                }
            }
        }
        
        const finalReport = Array.from(aggregatedMap.values());

        res.json({ success: true, data: finalReport });
    } catch (error) {
        console.error("Error generating audit report:", error);
        res.status(500).json({ success: false, message: 'Internal server error generating audit report' });
    }
};

module.exports = {
    getAuditReport
};
