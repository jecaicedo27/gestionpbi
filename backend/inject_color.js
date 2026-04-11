const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const color = await prisma.product.findFirst({
        where: { name: { contains: 'COLOR EN POLVO AMARILLO LIMON', mode: 'insensitive' } },
        select: { id: true, name: true, currentStock: true, productionZoneStock: true }
    });
    if (!color) { console.log('Product not found'); return; }
    console.log(`BEFORE: ${color.name} → currentStock: ${color.currentStock}g | zoneStock: ${color.productionZoneStock}g`);

    // Create a MaterialLot in PRODUCTION zone with 300g
    await prisma.materialLot.create({
        data: {
            productId: color.id,
            siigoProductCode: '',
            siigoProductName: color.name,
            lotNumber: `COLOR-AMARILLO-INJECT-${Date.now()}`,
            initialQuantity: 300,
            currentQuantity: 300,
            unit: 'gramo',
            receivedAt: new Date(),
            status: 'AVAILABLE',
            zone: 'PRODUCTION'
        }
    });

    // Increment productionZoneStock
    await prisma.product.update({
        where: { id: color.id },
        data: { productionZoneStock: { increment: 300 } }
    });

    const after = await prisma.product.findUnique({
        where: { id: color.id },
        select: { currentStock: true, productionZoneStock: true }
    });
    console.log(`AFTER:  ${color.name} → currentStock: ${after.currentStock}g | zoneStock: ${after.productionZoneStock}g`);
    console.log('✅ 300g de COLOR AMARILLO LIMON inyectados en zona de producción');
}
main().finally(() => prisma.$disconnect());
