const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sugar = await prisma.product.findFirst({ where: { name: { contains: 'AZUCAR', mode: 'insensitive' } } });
  
  // Checking adjustments RPA
  const badAdjustments = await prisma.rpaExecution.findMany({
      where: { executionType: 'SIIGO_ADJUSTMENT', status: { notIn: ['COMPLETED', 'SUCCESS'] } }
  });
  
  let adjustmentMissing = 0;
  for (const t of badAdjustments) {
      if (t.productName === sugar.name || t.productName === sugar.sku) {
          adjustmentMissing += t.quantity;
      }
  }
  console.log("Sugar locked in failed RPA Adjustments:", adjustmentMissing);

  // Check manual "LotConsumption" not linked to any assembly note?
  const orphanedConsumptions = await prisma.lotConsumption.findMany({
      where: {
          assemblyNoteId: null,
          materialLot: { productId: sugar.id }
      }
  });
  
  const orphanedQty = orphanedConsumptions.reduce((a,c) => a + c.quantityUsed, 0);
  console.log("Sugar consumed directly from Lots without Assembly Notes (Local only):", orphanedQty);

  // What about `Movements`? There is a `Movement` model tracking all inventory shifts.
  const movements = await prisma.movement.findMany({
      where: { productId: sugar.id, source: { not: 'SIIGO' } },
      orderBy: { date: 'desc' },
      take: 50
  });

  const outgoingMovements = await prisma.movement.aggregate({
      where: { productId: sugar.id, type: { in: ['SALIDA', 'AJUSTE_SALIDA', 'CONSUMO'] } },
      _sum: { quantity: true }
  });
  console.log("Total outgoing local movements for sugar (may not be synced to Siigo):", outgoingMovements._sum.quantity);
  
}

main().catch(console.error).finally(() => prisma.$disconnect());
