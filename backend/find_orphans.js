const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sugar = await prisma.product.findFirst({ where: { name: { contains: 'AZUCAR', mode: 'insensitive' } } });
  
  const orphanedConsumptions = await prisma.lotConsumption.findMany({
      where: {
          assemblyNoteId: null,
          materialLot: { productId: sugar.id }
      },
      orderBy: { usedAt: 'desc' },
      take: 20
  });
  
  console.log("Muestras de consumos huérfanos (sin nota de ensamble):");
  for (const c of orphanedConsumptions) {
      console.log(`- Fecha: ${c.usedAt ? c.usedAt.toISOString() : c.id} | Cantidad: ${c.quantityUsed} | Obs: ${c.observations}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
