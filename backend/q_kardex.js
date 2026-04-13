const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const product = await prisma.product.findFirst({
        where: { name: { contains: 'BASE SIROPE CLASICA' } },
        select: { id: true, name: true, productionZoneStock: true }
    });
    console.log('Product:', product);

    const transfers = await prisma.zoneTransfer.findMany({
        where: { productId: product.id },
        include: { transferredBy: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 3
    });
    console.log('Transfers:', JSON.stringify(transfers, null, 2));

    const consumptions = await prisma.lotConsumption.findMany({
        where: { materialLot: { productId: product.id } },
        include: { usedBy: { select: { name: true } }, assemblyNote: { select: { noteCode: true } } },
        orderBy: { usedAt: 'desc' },
        take: 3
    });
    console.log('Consumptions:', JSON.stringify(consumptions, null, 2));

    process.exit(0);
}
run();
