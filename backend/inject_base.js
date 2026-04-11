const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const baseId = '6a492be8-34e2-41e1-8d09-9ac7f3dfeac7';
    const inject = 203000; // 203 kg en gramos

    const before = await prisma.product.findUnique({
        where: { id: baseId },
        select: { name: true, currentStock: true, productionZoneStock: true }
    });
    console.log(`BEFORE: ${before.name} → currentStock: ${before.currentStock}g | zoneStock: ${before.productionZoneStock}g`);

    // Create MaterialLot in PRODUCTION zone
    await prisma.materialLot.create({
        data: {
            productId: baseId,
            siigoProductCode: '',
            siigoProductName: before.name,
            lotNumber: `BASE-SIROPE-INJECT-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`,
            initialQuantity: inject,
            currentQuantity: inject,
            unit: 'gramo',
            receivedAt: new Date(),
            status: 'AVAILABLE',
            zone: 'PRODUCTION'
        }
    });

    // Increment productionZoneStock
    await prisma.product.update({
        where: { id: baseId },
        data: { productionZoneStock: { increment: inject } }
    });

    const after = await prisma.product.findUnique({
        where: { id: baseId },
        select: { currentStock: true, productionZoneStock: true }
    });
    console.log(`AFTER:  ${before.name} → currentStock: ${after.currentStock}g | zoneStock: ${after.productionZoneStock}g`);

    // Verify total lots in zone
    const lots = await prisma.materialLot.findMany({
        where: { productId: baseId, zone: 'PRODUCTION', currentQuantity: { gt: 0 } },
        select: { lotNumber: true, currentQuantity: true }
    });
    const total = lots.reduce((s, l) => s + l.currentQuantity, 0);
    console.log(`Total lotes PRODUCTION: ${total}g (${(total/1000).toFixed(1)}kg)`);
    console.log(`✅ ${inject}g (${(inject/1000).toFixed(0)}kg) de BASE SIROPE inyectados en zona de producción`);
}
main().finally(() => prisma.$disconnect());
