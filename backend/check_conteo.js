const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
    try {
        const note = await p.assemblyNote.findUnique({
            where: { id: '2ab244e3-c656-4f19-a59d-a547d2fcc244' }
        });
        if (!note) {
            console.log('No Note Found');
            return;
        }

        const notes = await p.assemblyNote.findMany({
            where: { productionBatchId: note.productionBatchId },
            include: { processType: true },
            orderBy: { stageOrder: 'asc' }
        });

        notes.forEach(n => {
            console.log(n.processType?.code, n.status, n.stageName);
            if (n.processParameters?.conteo) {
                console.log(JSON.stringify(n.processParameters.conteo, null, 2));
            }
        });
    } catch (e) {
        console.error(e);
    } finally {
        await p.$disconnect();
    }
}
run();
