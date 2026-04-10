const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Check the specific LotConsumptions created for 1000ml
    const today = new Date('2026-04-07T00:00:00');
    
    const lcs = await prisma.lotConsumption.findMany({
        where: { 
            usedAt: { gte: today },
            materialLot: {
                OR: [
                    { product: { name: { contains: 'TARRO', mode: 'insensitive' } } },
                    { product: { name: { contains: 'TAPA', mode: 'insensitive' } } },
                    { product: { name: { contains: 'ETIQUETA', mode: 'insensitive' } } },
                    { product: { name: { contains: 'CAJA', mode: 'insensitive' } } },
                    { product: { name: { contains: 'FOIL', mode: 'insensitive' } } },
                ]
            }
        },
        include: {
            materialLot: { include: { product: { select: { name: true } } } },
            usedBy: { select: { name: true } },
            assemblyNote: { select: { stageName: true } }
        },
        orderBy: { usedAt: 'desc' }
    });
    
    console.log(`LotConsumptions de EMPAQUES hoy: ${lcs.length}`);
    for (const lc of lcs) {
        const name = lc.materialLot?.product?.name || lc.materialLot?.siigoProductName;
        console.log(`  [${lc.id.slice(0,8)}] ${name}: ${lc.quantityUsed} | usedAt=${lc.usedAt.toISOString()} | nota=${lc.assemblyNote?.stageName || 'sin nota'} | usedBy=${lc.usedBy?.name || 'sin usuario'}`);
    }
    
    // Total consumptions today
    const total = await prisma.lotConsumption.count({ where: { usedAt: { gte: today } } });
    console.log(`\nTotal LotConsumptions hoy: ${total} (limit de traza: 200)`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
