const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const prod = await prisma.product.findFirst({ where: { name: 'SIROPE GENIALITY SABOR A TAMARINDO X 360 ML' } });
    if(prod){
        await prisma.finishedLotStock.upsert({
            where: { productId_lotNumber_zone: { productId: prod.id, lotNumber: 'TAMARINDO-260410-0645', zone: 'PRODUCCION' } },
            update: { currentQuantity: 113, initialQuantity: 113 },
            create: { productId: prod.id, lotNumber: 'TAMARINDO-260410-0645', zone: 'PRODUCCION', initialQuantity: 113, currentQuantity: 113 }
        });
        console.log('Ingested 360ml 113');
    }
    const prod1000 = await prisma.product.findFirst({ where: { name: 'SIROPE GENIALITY SABOR A TAMARINDO X 1000 ML' } });
    if(prod1000){
        await prisma.finishedLotStock.upsert({
            where: { productId_lotNumber_zone: { productId: prod1000.id, lotNumber: 'TAMARINDO-260410-0645', zone: 'PRODUCCION' } },
            update: { currentQuantity: 100, initialQuantity: 100 },
            create: { productId: prod1000.id, lotNumber: 'TAMARINDO-260410-0645', zone: 'PRODUCCION', initialQuantity: 100, currentQuantity: 100 }
        });
        console.log('Ingested 1000ml 100');
    }
}
main().finally(() => prisma.$disconnect());
