const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const p = await prisma.product.findFirst({ where: { name: { contains: 'LIMON 3X ARRIERO' } } });
    if (!p) return;
    const consumptions = await prisma.lotConsumption.findMany({
        where: { materialLot: { productId: p.id } },
        include: { 
            assemblyNote: { 
                select: { id: true, processParameters: true, items: true }
            }
        },
        take: 5,
        orderBy: { usedAt: 'desc' }
    });
    console.log(JSON.stringify(consumptions, null, 2));
}
run();
