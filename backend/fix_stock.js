const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  const product = await prisma.product.findFirst({ where: { name: 'BASE SIROPE CLASICA' } });
  if (!product) { console.log("Not found"); return; }
  
  await prisma.product.update({
    where: { id: product.id },
    data: { productionZoneStock: { increment: 700 } }
  });

  const ts = Date.now().toString().slice(-6);
  await prisma.materialLot.create({
    data: {
      productId: product.id,
      lotNumber: `FIX-${ts}`,
      siigoProductCode: product.sku || '',
      siigoProductName: product.name || '',
      initialQuantity: 700,
      currentQuantity: 700,
      unit: product.unit || 'gramo',
      receivedAt: new Date(),
      status: 'AVAILABLE',
      zone: 'PRODUCTION'
    }
  });
  console.log("Injected 700g to BASE SIROPE CLASICA");
}
fix().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
