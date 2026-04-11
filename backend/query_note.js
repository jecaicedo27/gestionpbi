const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const note = await prisma.assemblyNote.findUnique({
        where: { id: 'eaa86447-0a72-4bde-861f-506687d46b40' },
        include: { productionBatch: { include: { outputTargets: true } } }
    });
    console.log(`Note productId: ${note.productId}`);
    console.log(`Note processParameters.product_id: ${note.processParameters?.product_id}`);
    
    for (const t of note.productionBatch.outputTargets) {
        console.log(`Target productId: ${t.productId} - planned: ${t.plannedUnits}`);
    }
}
main().finally(() => prisma.$disconnect());
