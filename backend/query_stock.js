const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({
    where: {
      name: {
        in: [
          'TARRO LIQUIPOPS 1150 GR - 1000ML',
          'TAPA LIQUIPOPS 1150 GR - 1000ML',
          'LINER TAPA LIQUIPOPS 350 GR',
          'TAPA LIQUIPOPS 350 GR - 300ML',
          'LINER TAPA LIQUIPOPS 1150 GR',
          'TARRO LIQUIPOPS 350 GR -  300 ML'
        ]
      }
    },
    select: { id: true, name: true, currentStock: true, productionZoneStock: true }
  });
  console.log(JSON.stringify(products, null, 2));
  
  // also get sums from materialLots
  for (const p of products) {
     const sum = await prisma.materialLot.aggregate({
         where: { productId: p.id, zone: 'PRODUCTION', currentQuantity: { gt: 0 } },
         _sum: { currentQuantity: true }
     });
     console.log(`${p.name} Real Lot Stock in PRODUCTION: ${sum._sum.currentQuantity || 0}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
