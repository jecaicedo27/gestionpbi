const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Find MANGO BICHE and COCO batches from today
    const batches = await prisma.productionBatch.findMany({
        where: {
            batchNumber: { in: ['MANGO-BICHE-260410-0711', 'COCO-260410-1110'] }
        },
        include: {
            outputTargets: { include: { product: { select: { id: true, name: true } } } }
        }
    });

    for (const b of batches) {
        console.log(`\n=== BATCH: ${b.batchNumber} ===`);
        console.log(`Output targets:`);
        for (const t of b.outputTargets) {
            console.log(`  - ${t.product?.name}: plannedUnits=${t.plannedUnits}, actualUnits=${t.actualUnits}, productId=${t.productId}`);
        }

        const notes = await prisma.assemblyNote.findMany({
            where: { productionBatchId: b.id },
            include: { processType: true }
        });

        const conteoNote = notes.find(n => n.processType?.code === 'CONTEO');
        if (conteoNote) {
            const pp = conteoNote.processParameters || {};
            console.log(`CONTEO note found: ${conteoNote.id}, status: ${conteoNote.status}`);
            if (pp.carriots) console.log(`  carriots: ${JSON.stringify(pp.carriots).slice(0, 300)}`);
            if (pp.conteo) console.log(`  conteo: ${JSON.stringify(pp.conteo).slice(0, 300)}`);
            if (pp.conteo_draft) console.log(`  conteo_draft: ${JSON.stringify(pp.conteo_draft).slice(0, 300)}`);
            if (!pp.carriots && !pp.conteo && !pp.conteo_draft) console.log(`  No conteo/carriots data yet`);
        } else {
            console.log(`No CONTEO note found`);
        }
    }
}
main().finally(() => prisma.$disconnect());
