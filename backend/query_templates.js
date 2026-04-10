const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const templates = await prisma.genialityTemplate.findMany({
    include: { items: { include: { product: true } } }
  });

  templates.forEach(t => {
      const hasLiquipops = t.items.some(i => i.product && i.product.name.includes("LIQUIPOPS 1150"));
      if (hasLiquipops) {
          console.log(`Template: ${t.name} (Code: ${t.code}) contains Tarro Liquipops.`);
      }
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
