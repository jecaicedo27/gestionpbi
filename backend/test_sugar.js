const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const sugar = await prisma.product.findFirst({ where: { name: { contains: 'AZUCAR', mode: 'insensitive' } } });
    
    // Total sugar in orphan consumptions
    const countQuery = await prisma.lotConsumption.aggregate({
        where: {
            assemblyNoteId: null,
            materialLot: { productId: sugar.id }
        },
        _sum: { quantityUsed: true }
    });
    console.log("TOTAL AZUCAR ORFANADA: " + countQuery._sum.quantityUsed + " gramos");

    // Also get all failed RPA tasks related to sugar
    const failedTasks = await prisma.rpaExecution.findMany({
        where: { status: { in: ['FAILED', 'SKIPPED'] } },
        include: { assemblyNote: { include: { lotConsumptions: { include: { materialLot: true } } } } }
    });
    
    let failedSugar = 0;
    for (const t of failedTasks) {
        if (!t.assemblyNote) continue;
        for (const c of t.assemblyNote.lotConsumptions) {
            if (c.materialLot.productId === sugar.id) {
                failedSugar += c.quantityUsed;
            }
        }
    }
    console.log("TOTAL AZUCAR EN RPA FALLIDOS: " + failedSugar + " gramos");
}
main().catch(console.error).finally(() => prisma.$disconnect());
