const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const rawNote = await prisma.assemblyNote.findUnique({ where: { id: '9bb6fbdd-a24a-4dcc-a2c3-705a2b20c445'} });
    if (!rawNote) return console.log('No Note');
    
    const batchId = rawNote.productionBatchId;
    console.log("Batch ID:", batchId);

    const related = await prisma.assemblyNote.findMany({
        where: { productionBatchId: batchId },
        include: { processType: true }
    });

    for (const r of related) {
        console.log(`\nNote: ${r.id} | Code: ${r.processType?.code}`);
        let params = r.processParameters || {};
        if (params.carriots) {
            console.log(`Carriots count: ${params.carriots.length}`);
            if (params.carriots.length > 0) {
                 console.log(JSON.stringify(params.carriots, null, 2));
            }
        }
        if (params.conteo) {
            console.log(`Conteo map keys: ${Object.keys(params.conteo)}`);
            for (const key of Object.keys(params.conteo)) {
                console.log(`  - ${key}: productId = ${params.conteo[key].productId}`);
            }
        }
        
    }
    
    const target = await prisma.productionBatch.findUnique({
        where: { id: batchId },
        include: { outputTargets: true }
    });
    console.log("\nOutput targets on batch:", JSON.stringify(target.outputTargets, null, 2));
}
main().finally(() => prisma.$disconnect());
