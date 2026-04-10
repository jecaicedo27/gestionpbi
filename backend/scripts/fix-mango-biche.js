const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batchNumber = 'MANGO-BICHE-260406-1621';
    const productId = '099da866-d2e0-4dba-8500-fb925275637e';

    await prisma.finishedLotStock.updateMany({
        where: { lotNumber: batchNumber, productId, zone: 'PRODUCCION' },
        data: { initialQuantity: 483, currentQuantity: 3 }
    });

    const notes = await prisma.assemblyNote.findMany({
        where: { productionBatch: { batchNumber }, processType: { code: 'EMPAQUE' }, productId }
    });
    
    if (notes.length > 0) {
        const note = notes[0];
        const params = note.processParameters;
        params.empaque.conteo_qty = 483;
        params.empaque.approved_qty = 483;
        
        await prisma.assemblyNote.update({
            where: { id: note.id },
            data: { processParameters: params, actualQuantity: 483 }
        });
    }

    console.log("Fixed Mango Biche to 483");
}
main().catch(console.error).finally(() => prisma.$disconnect());
