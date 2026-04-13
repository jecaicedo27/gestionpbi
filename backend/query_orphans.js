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
    console.log("TOTAL AZUCAR CONSUMIDA SIN NOTA DE ENSAMBLE: " + countQuery._sum.quantityUsed + " gramos");

    // Sample
    const orphans = await prisma.lotConsumption.findMany({
        where: { assemblyNoteId: null, materialLot: { productId: sugar.id } },
        include: { usedBy: true },
        take: 10,
        orderBy: { usedAt: 'desc' }
    });
    
    for (const c of orphans) {
        console.log(`Fecha: ${c.usedAt.toISOString()} | Cantidad: ${c.quantityUsed}g | Usuario: ${c.usedBy.name} | Obs: ${c.observations}`);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
