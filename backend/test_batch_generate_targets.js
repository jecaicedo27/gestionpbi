const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const assemblyService = require('./src/services/genialityAssemblyService');
async function main() {
    const tmpl = await prisma.assemblyTemplate.findFirst({ where: { templateCode: 'GTPL-TAMARINDO' } });
    const product360 = await prisma.product.findFirst({ where: { name: 'SIROPE GENIALITY SABOR A TAMARINDO X 360 ML'} });
    
    const batch = await prisma.productionBatch.create({
        data: {
            batchNumber: 'TEST-TAMARINDO-TARGETS-4',
            flavor: 'TAMARINDO',
            scheduledStart: new Date(),
            scheduledEnd: new Date(),
            baseWeight: 100,
            projectedTotalWeight: 100,
            status: 'PENDING',
            outputTargets: {
                create: [
                    { productId: product360.id, plannedUnits: 100, plannedWeightKg: 50 },
                    // 1000 ML left out intentionally
                ]
            }
        }
    });

    const res = await assemblyService.generateNotesForBatch(batch.id, tmpl.id);
    for (const note of res.notes) {
        console.log(note.stageOrder, note.stageName, '-> status:', note.status, '| prodId:', note.productId);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
