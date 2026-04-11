const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const assemblyService = require('./src/services/genialityAssemblyService');
async function main() {
    // get a GTPL template to use
    const tmpl = await prisma.assemblyTemplate.findFirst({ where: { templateCode: 'GTPL-TAMARINDO' } });
    
    // create a fake batch
    const batch = await prisma.productionBatch.create({
        data: {
            batchNumber: 'TEST-TAMARINDO-260410',
            flavor: 'TAMARINDO',
            scheduledStart: new Date(),
            scheduledEnd: new Date(),
            baseWeight: 100,
            projectedTotalWeight: 100,
            status: 'PENDING'
        }
    });

    console.log('Batch created:', batch.id);
    
    // Generate notes
    const res = await assemblyService.generateNotesForBatch(batch.id, tmpl.id);
    console.log('Generated notes count:', res.notes.length);
    for (const note of res.notes) {
        console.log(note.stageOrder, note.stageName);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
