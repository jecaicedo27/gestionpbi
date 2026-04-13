const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  await prisma.$transaction(async (tx) => {
    // 1. Generate LOT
    const p = await tx.product.findUnique({ where: { sku: 'PROCEGENIALITY01' } });
    
    // 2. Add lot
    await tx.materialLot.create({
      data: {
        product: { connect: { id: p.id } },
        lotNumber: 'MANUAL-BASE-11APR-UPDATE',
        siigoProductCode: p.sku,
        siigoProductName: p.name,
        initialQuantity: 1000000,
        currentQuantity: 1000000,
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        status: 'AVAILABLE'
      }
    });

    // 3. Update stock
    await tx.product.update({
        where: { id: p.id },
        data: { productionZoneStock: { increment: 1000000 } }
    });
    console.log('✅ Inyectados 1,000,000g (1000kg) de BASE SIROPE CLASICA y creado MaterialLot');
  });
}
run().catch(console.error).finally(() => prisma.$disconnect());
