const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inject() {
  const product = await prisma.product.findFirst({ where: { name: 'PREMEZCLA CONSERVANTES PERLAS' } });
  console.log('Product ID:', product.id);

  // Check existing PRODUCTION zone lots
  const productionLots = await prisma.materialLot.findMany({
    where: { productId: product.id, zone: 'PRODUCTION' }
  });
  console.log('Lotes en zona PRODUCTION:', productionLots.map(l => ({ lot: l.lotNumber, qty: l.currentQuantity, status: l.status })));

  // Check ALL lots
  const allLots = await prisma.materialLot.findMany({
    where: { productId: product.id, currentQuantity: { gt: 0 }, status: { in: ['AVAILABLE', 'LOW_STOCK'] } }
  });
  console.log('Lotes disponibles (cualquier zona):', allLots.map(l => ({ lot: l.lotNumber, qty: l.currentQuantity, zone: l.zone, status: l.status })));

  if (productionLots.length > 0) {
    // Update existing PRODUCTION lot
    const lot = productionLots[0];
    await prisma.materialLot.update({ where: { id: lot.id }, data: { currentQuantity: { increment: 1 }, status: 'AVAILABLE' } });
    console.log('✅ Actualizado lote existente en zona PRODUCTION:', lot.lotNumber);
  } else if (allLots.length > 0) {
    // Transfer from an existing lot to PRODUCTION zone
    const lot = allLots[0];
    await prisma.materialLot.update({ where: { id: lot.id }, data: { zone: 'PRODUCTION', status: 'AVAILABLE' } });
    console.log('✅ Movido lote a zona PRODUCTION:', lot.lotNumber, 'qty:', lot.currentQuantity);
  } else {
    // Create a temporary PRODUCTION lot
    const newLot = await prisma.materialLot.create({
      data: {
        productId: product.id,
        lotNumber: `URGENTE-${Date.now()}`,
        initialQuantity: 1,
        currentQuantity: 1,
        unit: 'unidad',
        zone: 'PRODUCTION',
        status: 'AVAILABLE',
        receivedAt: new Date(),
        siigoProductCode: product.sku,
        siigoProductName: product.name
      }
    });
    console.log('✅ Creado nuevo lote temporal en zona PRODUCTION:', newLot.lotNumber);
  }

  // Update cached field too
  await prisma.product.update({ where: { id: product.id }, data: { productionZoneStock: 1 } });

  const check = await prisma.product.findUnique({ where: { id: product.id }, select: { productionZoneStock: true } });
  console.log('productionZoneStock (cache):', check.productionZoneStock);
}

inject().catch(console.error).finally(() => prisma.$disconnect());
